import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useEmployee } from "@/hooks/use-employee";
import { ROLE_LABELS } from "@/lib/format";

const nav = [
  { to: "/desktop", label: "Overview", exact: true },
  { to: "/desktop/finance", label: "Finance" },
  { to: "/desktop/employees", label: "Employees" },
  { to: "/desktop/operations", label: "Operations" },
];

export function DesktopShell({ children }: { children: ReactNode }) {
  const { employee, loading, session } = useEmployee();
  const navigate = useNavigate();
  const loc = useLocation();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-[--t2]">Loading console…</div>;
  }

  if (!session) {
    if (typeof window !== "undefined") navigate({ to: "/auth" });
    return null;
  }

  if (employee?.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="card-elevated p-6 max-w-sm text-center">
          <div className="font-display text-lg font-extrabold">Administrators only</div>
          <p className="text-xs text-[--t3] mt-2">
            The desktop console is restricted to administrator accounts. Use the mobile app for your role.
          </p>
          <button onClick={() => navigate({ to: "/dashboard" })} className="mt-4 text-[11px] font-bold uppercase tracking-wider text-[--orange]">
            ← Back to app
          </button>
        </div>
      </div>
    );
  }

  const initials = employee.full_name?.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase() ?? "?";

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 shrink-0 border-r border-[--b1] bg-[--s1]/60 flex flex-col sticky top-0 h-screen">
        <div className="px-5 pt-6 pb-5">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[--t3]">DEXCARGO</div>
          <div className="font-display text-lg font-extrabold leading-tight">Admin Console</div>
        </div>
        <nav className="flex flex-col gap-1 px-3">
          {nav.map((n) => {
            const active = n.exact ? loc.pathname === n.to : loc.pathname.startsWith(n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`px-3 py-2 rounded-lg text-[13px] font-semibold transition ${
                  active ? "bg-[--blue] text-white" : "text-[--t2] hover:text-[--t1] hover:bg-[--s2]"
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto p-3">
          <Link to="/dashboard" className="block px-3 py-2 rounded-lg text-[11px] font-semibold text-[--t3] hover:text-[--t1]">
            Mobile view →
          </Link>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="flex items-center justify-between px-8 py-4 border-b border-[--b1] sticky top-0 z-20 bg-[--bg]/85 backdrop-blur">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[--t3]">
            Operations intelligence · Kenya
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-[12px] font-bold leading-tight">{employee.full_name}</div>
              <div className="text-[10px] text-[--orange] font-semibold">
                {ROLE_LABELS[employee.role] ?? employee.role} · {employee.employee_code}
              </div>
            </div>
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[--blue] to-[--orange] flex items-center justify-center text-[11px] font-bold text-white">
              {initials}
            </div>
            <button
              onClick={async () => {
                await supabase.auth.signOut();
                navigate({ to: "/auth" });
              }}
              className="text-[10px] text-[--t3] font-semibold uppercase tracking-wider hover:text-[--t1]"
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}

export function PageHead({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between mb-6">
      <div>
        <h1 className="font-display text-2xl font-extrabold leading-tight">{title}</h1>
        {subtitle && <p className="text-xs text-[--t3] mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Panel({ title, subtitle, children, className = "" }: { title: string; subtitle?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`card-elevated p-5 ${className}`}>
      <div className="mb-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-[--t2]">{title}</div>
        {subtitle && <div className="text-[10px] text-[--t3] mt-0.5">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

export function Kpi({ label, value, hint, tint = "blue" }: { label: string; value: string; hint?: string; tint?: "blue" | "orange" | "green" | "teal" }) {
  const c = { blue: "text-[--blue]", orange: "text-[--orange]", green: "text-[--green]", teal: "text-[--teal]" }[tint];
  return (
    <div className="card-surface p-4">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[--t3]">{label}</div>
      <div className={`font-display text-2xl font-extrabold mt-1.5 ${c}`}>{value}</div>
      {hint && <div className="text-[10px] text-[--t3] mt-1">{hint}</div>}
    </div>
  );
}
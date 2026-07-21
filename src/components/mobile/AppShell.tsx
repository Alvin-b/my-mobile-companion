import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useEmployee } from "@/hooks/use-employee";
import { ROLE_LABELS } from "@/lib/format";

const nav = [
  { to: "/dashboard", label: "Home", icon: HomeIcon },
  { to: "/packages", label: "Packages", icon: PkgIcon },
  { to: "/scan", label: "Scan", icon: ScanIcon, primary: true },
  { to: "/commissions", label: "Earnings", icon: CashIcon },
  { to: "/notifications", label: "Alerts", icon: BellIcon },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { employee, loading, session } = useEmployee();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[--t2]">Loading…</div>
    );
  }

  if (!session) {
    if (typeof window !== "undefined") navigate({ to: "/auth" });
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col max-w-[480px] mx-auto pb-24">
      <TopBar employee={employee} onLogout={async () => { await supabase.auth.signOut(); navigate({ to: "/auth" }); }} />
      <main className="flex-1">{children}</main>
      <BottomNav />
    </div>
  );
}

function TopBar({ employee, onLogout }: { employee: ReturnType<typeof useEmployee>["employee"]; onLogout: () => void }) {
  const initials = employee?.full_name?.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase() ?? "?";
  return (
    <div className="flex items-center justify-between px-4 pt-6 pb-3 sticky top-0 z-30 bg-[--bg]/85 backdrop-blur">
      <div>
        <div className="text-[10px] text-[--t3] font-semibold uppercase tracking-wider">DEXCARGO Ops</div>
        <div className="font-display text-[17px] font-bold leading-tight">
          {employee?.full_name ?? "Set up profile"}
        </div>
        <div className="text-[10px] text-[--orange] font-semibold mt-0.5">
          {employee ? `${ROLE_LABELS[employee.role]} · ${employee.employee_code}` : "No employee profile"}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {employee?.role === "admin" && (
          <Link
            to="/admin/employees"
            className="text-[10px] font-semibold uppercase tracking-wider text-[--blue] hover:text-[--t1] border border-[--b1] rounded-md px-2 py-1"
          >
            Admin
          </Link>
        )}
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[--blue] to-[--orange] flex items-center justify-center text-[11px] font-bold text-white">
          {initials}
        </div>
        <button onClick={onLogout} className="text-[10px] text-[--t3] font-semibold uppercase tracking-wider hover:text-[--t1]">Exit</button>
      </div>
    </div>
  );
}

function BottomNav() {
  const loc = useLocation();
  const path = loc.pathname;
  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] px-3 pb-4 pt-2 z-40 pointer-events-none">
      <div className="pointer-events-auto flex items-center justify-around bg-[--s2]/95 backdrop-blur border border-[--b1] rounded-2xl px-2 py-2 shadow-[0_10px_40px_rgba(0,0,0,.5)]">
        {nav.map((n) => {
          const active = path === n.to || (n.to !== "/dashboard" && path.startsWith(n.to));
          const Icon = n.icon;
          if (n.primary) {
            return (
              <Link key={n.to} to={n.to} className="-mt-6 flex flex-col items-center gap-1">
                <span className="w-12 h-12 rounded-2xl bg-[--blue] flex items-center justify-center shadow-lg shadow-blue-500/40 border-4 border-[--bg]">
                  <Icon className="w-5 h-5 text-white" />
                </span>
                <span className="text-[9px] font-bold text-white">{n.label}</span>
              </Link>
            );
          }
          return (
            <Link key={n.to} to={n.to}
              className={`flex flex-col items-center gap-1 py-1.5 px-3 rounded-lg transition ${active ? "text-[--orange]" : "text-[--t3] hover:text-[--t1]"}`}>
              <Icon className="w-4 h-4" />
              <span className="text-[9.5px] font-semibold">{n.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function HomeIcon({ className = "" }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12 12 3l9 9" /><path d="M5 10v10h5v-6h4v6h5V10" /></svg>;
}
function PkgIcon({ className = "" }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" /><path d="M3 8l9 5 9-5" /><path d="M12 22V13" /></svg>;
}
function ScanIcon({ className = "" }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.4"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h.01M14 17h3M17 14v3M17 17h.01" /></svg>;
}
function CashIcon({ className = "" }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="3" /></svg>;
}
function BellIcon({ className = "" }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21a2 2 0 0 0 4 0" /></svg>;
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="px-4 mt-5">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-[--t2]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function StatusPill({ status }: { status: string }) {
  const label = ({ received: "Received", verified: "Verified", awaiting_payment: "Awaiting pay", paid: "Paid", ready_for_collection: "Ready", collected: "Collected", cleared: "Cleared" } as Record<string,string>)[status] ?? status;
  const cls = ({
    received: "bg-purple-500/15 text-purple-300 border-purple-500/30",
    verified: "bg-blue-500/15 text-blue-300 border-blue-500/30",
    awaiting_payment: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    paid: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    ready_for_collection: "bg-teal-500/15 text-teal-300 border-teal-500/30",
    collected: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    cleared: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  } as Record<string, string>)[status] ?? "bg-slate-500/15 text-slate-300 border-slate-500/30";
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${cls}`}>{label}</span>;
}
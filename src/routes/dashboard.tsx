import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, Section, StatusPill } from "@/components/mobile/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useEmployee } from "@/hooks/use-employee";
import { fmtKES, fmtRelative } from "@/lib/format";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — DEXCARGO Ops" }] }),
  component: () => <AppShell><Dashboard /></AppShell>,
});

function Dashboard() {
  const { employee } = useEmployee();

  const stats = useQuery({
    queryKey: ["dash-stats", employee?.id],
    enabled: !!employee,
    queryFn: async () => {
      const today = new Date(); today.setHours(0,0,0,0);
      const isoToday = today.toISOString();
      const [{ count: intakeToday }, { count: awaiting }, { count: ready }, { data: commissions }] = await Promise.all([
        supabase.from("packages").select("*", { count: "exact", head: true }).gte("created_at", isoToday),
        supabase.from("packages").select("*", { count: "exact", head: true }).eq("status", "awaiting_payment"),
        supabase.from("packages").select("*", { count: "exact", head: true }).eq("status", "ready_for_collection"),
        supabase.from("commissions").select("amount, created_at").eq("employee_id", employee!.id).gte("created_at", isoToday),
      ]);
      const commissionToday = (commissions ?? []).reduce((a, c) => a + Number(c.amount ?? 0), 0);
      return { intakeToday: intakeToday ?? 0, awaiting: awaiting ?? 0, ready: ready ?? 0, commissionToday };
    },
  });

  const recent = useQuery({
    queryKey: ["dash-recent"],
    queryFn: async () => {
      const { data } = await supabase.from("packages").select("id, tracking_number, status, created_at, customers(full_name)").order("created_at", { ascending: false }).limit(6);
      return data ?? [];
    },
  });

  return (
    <div className="pb-6">
      <section className="px-4 mt-2">
        <div className="card-elevated p-4 relative overflow-hidden">
          <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_top_right,#F59E0B_0%,transparent_60%)]" />
          <div className="relative">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[--orange]">Today · Nairobi Hub</div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-display text-3xl font-extrabold">{fmtKES(stats.data?.commissionToday ?? 0)}</span>
              <span className="text-[11px] text-[--t2] font-semibold">commission accrued</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4">
              <Metric label="Intakes" value={stats.data?.intakeToday ?? 0} />
              <Metric label="Awaiting" value={stats.data?.awaiting ?? 0} tint="amber" />
              <Metric label="Ready" value={stats.data?.ready ?? 0} tint="teal" />
            </div>
          </div>
        </div>
      </section>

      <Section title="Quick Actions">
        <div className="grid grid-cols-2 gap-2">
          <ActionTile to="/scan" label="Scan Sticker" hint="Intake packages" icon="📷" />
          <ActionTile to="/packages" label="Package Book" hint="All in warehouse" icon="📦" />
          <ActionTile to="/customers" label="Customers" hint="Directory" icon="👥" />
          <ActionTile to="/commissions" label="Earnings" hint="Your commission" icon="💰" />
        </div>
      </Section>

      <Section title="Recent Activity" action={<Link to="/packages" className="text-[10px] text-[--orange] font-semibold uppercase">View all</Link>}>
        <div className="flex flex-col gap-2">
          {(recent.data ?? []).map((p: any) => (
            <Link key={p.id} to="/packages/$id" params={{ id: p.id }} className="card-surface p-3 flex items-center justify-between">
              <div>
                <div className="mono text-[11px] text-[--t2]">{p.tracking_number}</div>
                <div className="text-sm font-semibold mt-0.5">{p.customers?.full_name ?? "—"}</div>
                <div className="text-[10px] text-[--t3] mt-0.5">{fmtRelative(p.created_at)}</div>
              </div>
              <StatusPill status={p.status} />
            </Link>
          ))}
          {recent.data && recent.data.length === 0 && (
            <div className="text-xs text-[--t3] text-center py-6">No packages yet. Tap Scan to intake your first shipment.</div>
          )}
        </div>
      </Section>
    </div>
  );
}

function Metric({ label, value, tint }: { label: string; value: number | string; tint?: "amber" | "teal" }) {
  const color = tint === "amber" ? "text-[--orange]" : tint === "teal" ? "text-[--teal]" : "text-[--t1]";
  return (
    <div className="bg-[--s1]/70 border border-[--b1] rounded-lg p-2">
      <div className={`font-display text-xl font-extrabold leading-none ${color}`}>{value}</div>
      <div className="text-[9px] font-semibold uppercase tracking-wider text-[--t3] mt-1">{label}</div>
    </div>
  );
}

function ActionTile({ to, label, hint, icon }: { to: string; label: string; hint: string; icon: string }) {
  return (
    <Link to={to} className="card-surface p-3 flex items-start gap-2 active:scale-[.98] transition">
      <span className="text-xl">{icon}</span>
      <div>
        <div className="text-sm font-semibold">{label}</div>
        <div className="text-[10px] text-[--t3] mt-0.5">{hint}</div>
      </div>
    </Link>
  );
}
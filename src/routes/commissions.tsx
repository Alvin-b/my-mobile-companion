import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, Section } from "@/components/mobile/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { fmtKES, fmtRelative } from "@/lib/format";
import { useEmployee } from "@/hooks/use-employee";

export const Route = createFileRoute("/commissions")({
  head: () => ({ meta: [{ title: "Earnings — DEXCARGO Ops" }] }),
  component: () => <AppShell><Commissions /></AppShell>,
});

function Commissions() {
  const { employee } = useEmployee();
  const q = useQuery({
    queryKey: ["commissions", employee?.id],
    enabled: !!employee,
    queryFn: async () => {
      const { data } = await supabase.from("commissions")
        .select("id, amount, percentage, trigger, status, created_at, packages(tracking_number, customers(full_name))")
        .eq("employee_id", employee!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });

  const rows = q.data ?? [];
  const totals = rows.reduce((acc, r: any) => {
    const a = Number(r.amount ?? 0);
    acc.all += a;
    if (r.status === "pending") acc.pending += a;
    if (r.status === "approved") acc.approved += a;
    if (r.status === "paid") acc.paid += a;
    return acc;
  }, { all: 0, pending: 0, approved: 0, paid: 0 });

  return (
    <div className="pb-8">
      <section className="px-4 mt-2">
        <div className="card-elevated p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[--orange]">Your commission ledger</div>
          <div className="font-display text-3xl font-extrabold mt-1">{fmtKES(totals.all)}</div>
          <div className="grid grid-cols-3 gap-2 mt-4">
            <Tot label="Pending" v={totals.pending} tint="amber" />
            <Tot label="Approved" v={totals.approved} tint="teal" />
            <Tot label="Paid" v={totals.paid} tint="green" />
          </div>
        </div>
      </section>

      <Section title="History">
        <div className="flex flex-col gap-2">
          {rows.length === 0 && <div className="text-xs text-[--t3] text-center py-6">No commission entries yet.</div>}
          {rows.map((r: any) => (
            <div key={r.id} className="card-surface p-3 flex items-center justify-between">
              <div>
                <div className="mono text-[11px] text-[--t2]">{r.packages?.tracking_number ?? "—"}</div>
                <div className="text-sm font-semibold">{r.packages?.customers?.full_name ?? "—"}</div>
                <div className="text-[10px] text-[--t3] mt-0.5 capitalize">{r.trigger} · {r.status} · {fmtRelative(r.created_at)}</div>
              </div>
              <div className="mono font-bold text-[--orange]">{fmtKES(r.amount)}</div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Tot({ label, v, tint }: { label: string; v: number; tint: "amber" | "teal" | "green" }) {
  const c = tint === "amber" ? "text-[--orange]" : tint === "teal" ? "text-[--teal]" : "text-[--green]";
  return (
    <div className="bg-[--s1]/70 border border-[--b1] rounded-lg p-2">
      <div className={`mono text-sm font-bold ${c}`}>{fmtKES(v)}</div>
      <div className="text-[9px] font-semibold uppercase tracking-wider text-[--t3] mt-0.5">{label}</div>
    </div>
  );
}
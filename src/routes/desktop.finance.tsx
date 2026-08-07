import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Kpi, PageHead, Panel } from "@/components/desktop/DesktopShell";
import { dayKey, lastNDays, shortDay, useCargo, useCommissions, usePayments } from "@/hooks/use-admin-metrics";
import { supabase } from "@/integrations/supabase/client";
import { fmtKES, fmtRelative } from "@/lib/format";

export const Route = createFileRoute("/desktop/finance")({
  head: () => ({
    meta: [
      { title: "Finance — DEXCARGO Admin Console" },
      { name: "description", content: "Commission ledger, payment method mix and daily settlement analytics for DEXCARGO finance administrators." },
      { property: "og:title", content: "DEXCARGO Finance Analytics" },
      { property: "og:description", content: "Commission ledger, payment mix and settlement trends." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Finance,
});

const COMMISSION_TINT: Record<string, string> = { pending: "#F59E0B", approved: "#3B6BF5", paid: "#10B981" };
const METHOD_TINT = ["#10B981", "#3B6BF5", "#F59E0B", "#14B8A6"];
const axis = { stroke: "#64748B", fontSize: 10 };
const tooltipStyle = { background: "#111827", border: "1px solid #1F2937", borderRadius: 10, fontSize: 11, color: "#E2E8F0" };

function Finance() {
  const cargo = useCargo();
  const commissions = useCommissions();
  const payments = usePayments();
  const qc = useQueryClient();

  const comms = commissions.data ?? [];
  const pays = payments.data ?? [];
  const rows = cargo.data ?? [];

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("approve_commission", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["desktop", "commissions"] }),
  });

  const markPaid = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("mark_commission_paid", { _id: id, _reference: `CONSOLE-${Date.now()}` });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["desktop", "commissions"] }),
  });

  const totals = comms.reduce(
    (acc, c) => {
      const a = Number(c.amount ?? 0);
      acc.all += a;
      acc[c.status as "pending" | "approved" | "paid"] += a;
      return acc;
    },
    { all: 0, pending: 0, approved: 0, paid: 0 },
  );

  const statusMix = (["pending", "approved", "paid"] as const)
    .map((s) => ({ name: s, value: comms.filter((c) => c.status === s).length }))
    .filter((s) => s.value > 0);

  const methodMix = Object.entries(
    pays.reduce<Record<string, number>>((acc, p) => {
      const k = p.method ?? "unknown";
      acc[k] = (acc[k] ?? 0) + Number(p.amount ?? 0);
      return acc;
    }, {}),
  ).map(([name, value]) => ({ name, value }));

  const days = lastNDays(14);
  const daily = days.map((d) => ({
    day: shortDay(d),
    settled: rows.filter((r) => dayKey(r.paid_at) === d).reduce((s, r) => s + Number(r.cost ?? 0), 0),
    commission: comms.filter((c) => dayKey(c.created_at) === d).reduce((s, c) => s + Number(c.amount ?? 0), 0),
  }));

  return (
    <div>
      <PageHead title="Finance" subtitle={`${comms.length} commission entries · ${pays.length} payment records`} />

      <div className="grid grid-cols-4 gap-4">
        <Kpi label="Commission total" value={fmtKES(totals.all)} />
        <Kpi label="Pending approval" value={fmtKES(totals.pending)} tint="orange" />
        <Kpi label="Approved" value={fmtKES(totals.approved)} tint="teal" />
        <Kpi label="Paid out" value={fmtKES(totals.paid)} tint="green" />
      </div>

      <div className="grid grid-cols-3 gap-4 mt-4">
        <Panel title="Settlement vs commission" subtitle="Last 14 days" className="col-span-2">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={daily} margin={{ left: -8, right: 8, top: 8 }}>
              <CartesianGrid stroke="#1F2937" vertical={false} />
              <XAxis dataKey="day" tick={axis} tickLine={false} axisLine={false} />
              <YAxis tick={axis} tickLine={false} axisLine={false} width={64} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => fmtKES(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 10, color: "#94A3B8" }} />
              <Line type="monotone" dataKey="settled" stroke="#10B981" strokeWidth={2} dot={false} name="Settled cargo" />
              <Line type="monotone" dataKey="commission" stroke="#F59E0B" strokeWidth={2} dot={false} name="Commission accrued" />
            </LineChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Commission status" subtitle="Entry count by state">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={statusMix} dataKey="value" nameKey="name" innerRadius={50} outerRadius={86} paddingAngle={3} stroke="none">
                {statusMix.map((s) => (
                  <Cell key={s.name} fill={COMMISSION_TINT[s.name] ?? "#64748B"} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 10, color: "#94A3B8" }} />
            </PieChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <div className="grid grid-cols-3 gap-4 mt-4">
        <Panel title="Payment method mix" subtitle="Value collected by channel">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={methodMix} margin={{ left: -16, right: 8, top: 8 }}>
              <CartesianGrid stroke="#1F2937" vertical={false} />
              <XAxis dataKey="name" tick={axis} tickLine={false} axisLine={false} />
              <YAxis tick={axis} tickLine={false} axisLine={false} width={60} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(16,185,129,0.08)" }} formatter={(v: any) => fmtKES(Number(v))} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {methodMix.map((m, i) => (
                  <Cell key={m.name} fill={METHOD_TINT[i % METHOD_TINT.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Commission ledger" subtitle="Approve or settle entries" className="col-span-2">
          <div className="max-h-[260px] overflow-y-auto">
            <table className="w-full text-[12px]">
              <thead className="text-[10px] uppercase tracking-wider text-[--t3]">
                <tr className="text-left">
                  <th className="py-2">Employee</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {comms.slice(0, 40).map((c) => (
                  <tr key={c.id} className="border-t border-[--b1]">
                    <td className="py-2 pr-2">
                      <div className="font-semibold">{c.employees?.full_name ?? "—"}</div>
                      <div className="text-[10px] text-[--t3]">{c.employees?.employee_code ?? ""}</div>
                    </td>
                    <td className="mono font-bold text-[--orange]">{fmtKES(c.amount)}</td>
                    <td className="capitalize text-[--t2]">{c.status}</td>
                    <td className="text-[--t3]">{fmtRelative(c.created_at)}</td>
                    <td className="text-right">
                      {c.status === "pending" && (
                        <button onClick={() => approve.mutate(c.id)} className="text-[10px] font-bold uppercase tracking-wider text-[--blue] hover:text-[--t1]">
                          Approve
                        </button>
                      )}
                      {c.status === "approved" && (
                        <button onClick={() => markPaid.mutate(c.id)} className="text-[10px] font-bold uppercase tracking-wider text-[--green] hover:text-[--t1]">
                          Mark paid
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {comms.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-[--t3] text-[11px]">No commission entries yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
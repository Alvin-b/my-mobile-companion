import { createFileRoute } from "@tanstack/react-router";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Kpi, PageHead, Panel } from "@/components/desktop/DesktopShell";
import { dayKey, lastNDays, shortDay, useCargo, useCommissions, useStaff } from "@/hooks/use-admin-metrics";
import { fmtKES } from "@/lib/format";

export const Route = createFileRoute("/desktop/")({
  head: () => ({
    meta: [
      { title: "Overview — DEXCARGO Admin Console" },
      { name: "description", content: "Cargo volume, revenue trend, status mix and top performing sales reps at a glance." },
      { property: "og:title", content: "DEXCARGO Console Overview" },
      { property: "og:description", content: "Cargo volume, revenue trend and status mix for DEXCARGO administrators." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Overview,
});

const STATUS_TINT: Record<string, string> = {
  registered: "#8B5CF6",
  received: "#8B5CF6",
  verified: "#3B6BF5",
  awaiting_payment: "#F59E0B",
  paid: "#10B981",
  ready_for_collection: "#14B8A6",
  collected: "#38BDF8",
  cleared: "#94A3B8",
};
const MODE_TINT = ["#3B6BF5", "#F59E0B", "#14B8A6", "#8B5CF6", "#10B981"];

const axis = { stroke: "#64748B", fontSize: 10 };
const tooltipStyle = {
  background: "#111827",
  border: "1px solid #1F2937",
  borderRadius: 10,
  fontSize: 11,
  color: "#E2E8F0",
};

function Overview() {
  const cargo = useCargo();
  const commissions = useCommissions();
  const staff = useStaff();

  const rows = cargo.data ?? [];
  const comms = commissions.data ?? [];
  const people = staff.data ?? [];

  const revenue = rows.filter((r) => r.paid_at).reduce((s, r) => s + Number(r.cost ?? 0), 0);
  const pendingCommission = comms.filter((c) => c.status === "pending").reduce((s, c) => s + Number(c.amount ?? 0), 0);
  const inTransit = rows.filter((r) => !["collected", "cleared"].includes(r.status)).length;

  // Company money position: everything a linked payment (evidence or M-Pesa)
  // has cleared, versus what is still owed and what is due to staff.
  const outstanding = rows.filter((r) => !r.paid_at).reduce((s, r) => s + Number(r.cost ?? 0), 0);
  const commissionAccrued = comms.reduce((s, c) => s + Number(c.amount ?? 0), 0);
  const netRetained = revenue - commissionAccrued;
  const paidCount = rows.filter((r) => r.paid_at).length;
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).getTime();
  const revenueThisMonth = rows
    .filter((r) => r.paid_at && new Date(r.paid_at).getTime() >= monthStart)
    .reduce((s, r) => s + Number(r.cost ?? 0), 0);

  const days = lastNDays(14);
  const trend = days.map((d) => {
    const registered = rows.filter((r) => dayKey(r.registered_at) === d).length;
    const paidRevenue = rows.filter((r) => dayKey(r.paid_at) === d).reduce((s, r) => s + Number(r.cost ?? 0), 0);
    return { day: shortDay(d), registered, revenue: paidRevenue };
  });

  const statusMix = Object.entries(
    rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {}),
  ).map(([name, value]) => ({ name, value }));

  const modeMix = Object.entries(
    rows.reduce<Record<string, number>>((acc, r) => {
      const k = r.mode?.trim() || "unspecified";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {}),
  ).map(([name, value]) => ({ name, value }));

  const byRep = Object.entries(
    rows.reduce<Record<string, number>>((acc, r) => {
      const k = r.sales_rep?.trim() || "Unassigned";
      acc[k] = (acc[k] ?? 0) + Number(r.cost ?? 0);
      return acc;
    }, {}),
  )
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const loading = cargo.isLoading || commissions.isLoading || staff.isLoading;

  return (
    <div>
      <PageHead
        title="Overview"
        subtitle={loading ? "Loading live data…" : `${rows.length} cargo records · ${people.filter((p) => p.is_active).length} active staff`}
      />

      <div className="grid grid-cols-4 gap-4">
        <Kpi label="Total cargo" value={String(rows.length)} hint={`${inTransit} still in the pipeline`} />
        <Kpi label="Collected revenue" value={fmtKES(revenue)} hint="Paid cargo only" tint="green" />
        <Kpi label="Commission pending" value={fmtKES(pendingCommission)} hint={`${comms.filter((c) => c.status === "pending").length} entries awaiting approval`} tint="orange" />
        <Kpi label="Active staff" value={String(people.filter((p) => p.is_active).length)} hint={`${people.length} total accounts`} tint="teal" />
      </div>

      <div className="mt-4">
        <Panel title="Company total" subtitle="All cleared cargo value, net of staff commission">
          <div className="grid grid-cols-4 gap-4">
            <Kpi label="Total money in" value={fmtKES(revenue)} hint={`${paidCount} packages cleared`} tint="green" />
            <Kpi label="This month" value={fmtKES(revenueThisMonth)} hint="Cleared since the 1st" />
            <Kpi label="Still unpaid" value={fmtKES(outstanding)} hint={`${rows.length - paidCount} packages awaiting payment`} tint="orange" />
            <Kpi label="Net after commission" value={fmtKES(netRetained)} hint={`${fmtKES(commissionAccrued)} accrued to staff`} tint="teal" />
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-3 gap-4 mt-4">
        <Panel title="Revenue trend" subtitle="Last 14 days · paid cargo" className="col-span-2">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={trend} margin={{ left: -12, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10B981" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#10B981" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1F2937" vertical={false} />
              <XAxis dataKey="day" tick={axis} tickLine={false} axisLine={false} />
              <YAxis tick={axis} tickLine={false} axisLine={false} width={64} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => fmtKES(Number(v))} />
              <Area type="monotone" dataKey="revenue" stroke="#10B981" strokeWidth={2} fill="url(#revFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Status mix" subtitle="Share of all cargo">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={statusMix} dataKey="value" nameKey="name" innerRadius={52} outerRadius={86} paddingAngle={3} stroke="none">
                {statusMix.map((s) => (
                  <Cell key={s.name} fill={STATUS_TINT[s.name] ?? "#64748B"} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 10, color: "#94A3B8" }} />
            </PieChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <div className="grid grid-cols-3 gap-4 mt-4">
        <Panel title="Intake volume" subtitle="Packages registered per day" className="col-span-2">
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={trend} margin={{ left: -18, right: 8, top: 8 }}>
              <CartesianGrid stroke="#1F2937" vertical={false} />
              <XAxis dataKey="day" tick={axis} tickLine={false} axisLine={false} />
              <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(59,107,245,0.08)" }} />
              <Bar dataKey="registered" fill="#3B6BF5" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Freight mode" subtitle="Air vs sea vs other">
          <ResponsiveContainer width="100%" height={230}>
            <PieChart>
              <Pie data={modeMix} dataKey="value" nameKey="name" outerRadius={82} stroke="none">
                {modeMix.map((m, i) => (
                  <Cell key={m.name} fill={MODE_TINT[i % MODE_TINT.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 10, color: "#94A3B8" }} />
            </PieChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <div className="mt-4">
        <Panel title="Revenue by sales rep" subtitle="Top 6 by cargo value">
          <ResponsiveContainer width="100%" height={Math.max(180, byRep.length * 42)}>
            <BarChart data={byRep} layout="vertical" margin={{ left: 24, right: 24 }}>
              <CartesianGrid stroke="#1F2937" horizontal={false} />
              <XAxis type="number" tick={axis} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" tick={axis} tickLine={false} axisLine={false} width={130} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(245,158,11,0.08)" }} formatter={(v: any) => fmtKES(Number(v))} />
              <Bar dataKey="value" fill="#F59E0B" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>
    </div>
  );
}
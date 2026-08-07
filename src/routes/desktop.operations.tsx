import { createFileRoute } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Kpi, PageHead, Panel } from "@/components/desktop/DesktopShell";
import { useCargo } from "@/hooks/use-admin-metrics";
import { fmtKES, fmtRelative } from "@/lib/format";

export const Route = createFileRoute("/desktop/operations")({
  head: () => ({
    meta: [
      { title: "Operations — DEXCARGO Admin Console" },
      { name: "description", content: "Cargo pipeline health, destination volumes, freight weight distribution and the latest cargo intake records." },
      { property: "og:title", content: "DEXCARGO Operations Analytics" },
      { property: "og:description", content: "Pipeline health, destination volumes and latest cargo intake." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Operations,
});

const axis = { stroke: "#64748B", fontSize: 10 };
const tooltipStyle = { background: "#111827", border: "1px solid #1F2937", borderRadius: 10, fontSize: 11, color: "#E2E8F0" };
const DEST_TINT = ["#3B6BF5", "#F59E0B", "#14B8A6", "#8B5CF6", "#10B981", "#38BDF8"];

function Operations() {
  const cargo = useCargo();
  const rows = cargo.data ?? [];

  const pipeline = ["registered", "paid", "collected"].map((s) => ({
    name: s,
    value: rows.filter((r) => r.status === s).length,
  }));

  const destMix = Object.entries(
    rows.reduce<Record<string, number>>((acc, r) => {
      const k = r.dest?.trim() || "Unknown";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const weightBuckets = [
    { name: "0–5 kg", test: (w: number) => w <= 5 },
    { name: "5–20 kg", test: (w: number) => w > 5 && w <= 20 },
    { name: "20–50 kg", test: (w: number) => w > 20 && w <= 50 },
    { name: "50 kg+", test: (w: number) => w > 50 },
  ].map((b) => ({ name: b.name, value: rows.filter((r) => b.test(Number(r.weight ?? 0))).length }));

  const totalPieces = rows.reduce((s, r) => s + Number(r.pcs ?? 0), 0);
  const totalWeight = rows.reduce((s, r) => s + Number(r.weight ?? 0), 0);
  const unpaid = rows.filter((r) => !r.paid_at);

  return (
    <div>
      <PageHead title="Operations" subtitle={`${rows.length} cargo records tracked`} />

      <div className="grid grid-cols-4 gap-4">
        <Kpi label="Total pieces" value={String(totalPieces)} />
        <Kpi label="Total weight" value={`${totalWeight.toLocaleString("en-KE", { maximumFractionDigits: 1 })} kg`} tint="teal" />
        <Kpi label="Awaiting payment" value={String(unpaid.length)} hint={fmtKES(unpaid.reduce((s, r) => s + Number(r.cost ?? 0), 0)) + " outstanding"} tint="orange" />
        <Kpi label="Collected" value={String(rows.filter((r) => r.collected_at).length)} tint="green" />
      </div>

      <div className="grid grid-cols-3 gap-4 mt-4">
        <Panel title="Top destinations" subtitle="Cargo count" className="col-span-2">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={destMix} margin={{ left: -18, right: 8, top: 8 }}>
              <CartesianGrid stroke="#1F2937" vertical={false} />
              <XAxis dataKey="name" tick={axis} tickLine={false} axisLine={false} />
              <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(59,107,245,0.08)" }} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {destMix.map((d, i) => (
                  <Cell key={d.name} fill={DEST_TINT[i % DEST_TINT.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Pipeline stage" subtitle="Registered → paid → collected">
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={pipeline} dataKey="value" nameKey="name" innerRadius={48} outerRadius={84} paddingAngle={3} stroke="none">
                {pipeline.map((p, i) => (
                  <Cell key={p.name} fill={["#8B5CF6", "#10B981", "#38BDF8"][i]} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 10, color: "#94A3B8" }} />
            </PieChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <div className="grid grid-cols-3 gap-4 mt-4">
        <Panel title="Weight distribution" subtitle="Shipment size bands">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={weightBuckets} margin={{ left: -18, right: 8, top: 8 }}>
              <CartesianGrid stroke="#1F2937" vertical={false} />
              <XAxis dataKey="name" tick={axis} tickLine={false} axisLine={false} />
              <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(20,184,166,0.08)" }} />
              <Bar dataKey="value" fill="#14B8A6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Latest intake" subtitle="Most recent cargo registrations" className="col-span-2">
          <div className="max-h-[240px] overflow-y-auto">
            <table className="w-full text-[12px]">
              <thead className="text-[10px] uppercase tracking-wider text-[--t3]">
                <tr className="text-left">
                  <th className="py-2">Tracking</th>
                  <th>Route</th>
                  <th>Mode</th>
                  <th>Value</th>
                  <th>Status</th>
                  <th>Registered</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 30).map((r) => (
                  <tr key={r.id} className="border-t border-[--b1]">
                    <td className="py-2 mono text-[--orange]">{r.id}</td>
                    <td className="text-[--t2]">{(r.origin ?? "—") + " → " + (r.dest ?? "—")}</td>
                    <td className="capitalize text-[--t2]">{r.mode ?? "—"}</td>
                    <td className="mono">{fmtKES(r.cost)}</td>
                    <td className="capitalize text-[--t2]">{r.status}</td>
                    <td className="text-[--t3]">{fmtRelative(r.registered_at)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="py-6 text-center text-[--t3] text-[11px]">No cargo records yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
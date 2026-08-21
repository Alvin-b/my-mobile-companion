import { createFileRoute } from "@tanstack/react-router";
import { PageHead, Panel } from "@/components/desktop/DesktopShell";
import { useCargo, type CargoRow } from "@/hooks/use-admin-metrics";
import { fmtKES, fmtRelative } from "@/lib/format";

export const Route = createFileRoute("/desktop/packages")({ component: DesktopPackages });

const categories = [
  { key: "general", title: "General Cargo", subtitle: "Normal air cargo", tint: "text-[--blue]" },
  { key: "special", title: "Special Cargo", subtitle: "Special air cargo", tint: "text-[--orange]" },
  { key: "sea", title: "Sea Cargo", subtitle: "Sea freight", tint: "text-[--teal]" },
] as const;

function packageCategory(row: CargoRow) {
  if (row.cargo_category === "special" || row.cargo_category === "sea") return row.cargo_category;
  return "general";
}

function DesktopPackages() {
  const cargo = useCargo();
  const rows = cargo.data ?? [];

  return <div>
    <PageHead title="Packages" subtitle={cargo.isLoading ? "Loading package data…" : `${rows.length} registered packages · grouped by manifest category`} />
    <div className="grid grid-cols-3 gap-4">
      {categories.map((category) => {
        const group = rows.filter((row) => packageCategory(row) === category.key);
        return <Panel key={category.key} title={category.title} subtitle={`${category.subtitle} · ${group.length} package${group.length === 1 ? "" : "s"}`}>
          <div className={`font-display text-3xl font-extrabold mb-4 ${category.tint}`}>{group.length}</div>
          <PackageTable rows={group} />
        </Panel>;
      })}
    </div>
  </div>;
}

function PackageTable({ rows }: { rows: CargoRow[] }) {
  return <div className="max-h-[520px] overflow-auto">
    <table className="w-full text-[11px]">
      <thead className="sticky top-0 bg-[--s1] text-[9px] uppercase tracking-wider text-[--t3]">
        <tr className="text-left"><th className="pb-2">Tracking / client</th><th>Pieces</th><th>Value</th><th>Status</th></tr>
      </thead>
      <tbody>
        {rows.map((row) => <tr key={row.id} className="border-t border-[--b1] align-top">
          <td className="py-2 pr-2"><div className="mono text-[--orange]">{row.tracking_number ?? row.id}</div><div className="mt-0.5 text-[--t2]">{row.consignee ?? "Unassigned client"}</div><div className="mt-0.5 text-[10px] text-[--t3]">{row.weight ?? "—"} kg · {fmtRelative(row.registered_at)}</div></td>
          <td>{row.pcs ?? "—"}</td><td className="mono">{row.cost == null ? "—" : fmtKES(row.cost)}</td><td className="capitalize text-[--t2]">{row.status}</td>
        </tr>)}
        {!rows.length && <tr><td colSpan={4} className="py-6 text-center text-[--t3]">No packages yet.</td></tr>}
      </tbody>
    </table>
  </div>;
}

import { createFileRoute } from "@tanstack/react-router";
import { PageHead, Panel } from "@/components/desktop/DesktopShell";
import { useCargo, type CargoRow } from "@/hooks/use-admin-metrics";
import { fmtKES, fmtRelative } from "@/lib/format";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEmployee } from "@/hooks/use-employee";

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
  const { employee } = useEmployee();
  const qc = useQueryClient();
  const rows = cargo.data ?? [];
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const visibleRows = rows.filter((row) => !needle || [row.tracking_number, row.id, row.consignee, row.sales_rep, row.dest].join(" ").toLowerCase().includes(needle));
  const release = useMutation({
    mutationFn: async (packageId: string) => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error("Sign in again to release cargo.");
      const response = await fetch(`/api/public/packages/${packageId}/release`, { method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}` } });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Cargo could not be released.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["desktop", "cargo"] }),
  });

  return <div>
    <PageHead title="Packages" subtitle={cargo.isLoading ? "Loading package data…" : `${visibleRows.length} shown · ${rows.length} registered packages`} action={<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tracking, client or sales rep" className="w-80 bg-[--s1] border border-[--b1] rounded-lg px-3 py-2 text-sm" />} />
    <div className="grid grid-cols-3 gap-4">
      {categories.map((category) => {
        const group = visibleRows.filter((row) => packageCategory(row) === category.key);
        return <Panel key={category.key} title={category.title} subtitle={`${category.subtitle} · ${group.length} package${group.length === 1 ? "" : "s"}`}>
          <div className={`font-display text-3xl font-extrabold mb-4 ${category.tint}`}>{group.length}</div>
          <PackageTable rows={group} canRelease={employee?.role === "admin" || employee?.role === "logistics_manager" || employee?.role === "sales_manager"} onRelease={(id) => { if (window.confirm("Release this paid package from the warehouse?")) release.mutate(id); }} releasing={release.isPending} />
        </Panel>;
      })}
    </div>
  </div>;
}

function PackageTable({ rows, canRelease, onRelease, releasing }: { rows: CargoRow[]; canRelease: boolean; onRelease: (id: string) => void; releasing: boolean }) {
  return <div className="max-h-[620px] overflow-auto">
    <table className="w-full text-[12px]">
      <thead className="sticky top-0 bg-[--s1] text-[9px] uppercase tracking-wider text-[--t3]">
        <tr className="text-left"><th className="pb-2">Tracking / client</th><th>Pieces</th><th>Value</th><th>Status</th><th className="text-right">Action</th></tr>
      </thead>
      <tbody>
        {rows.map((row) => <tr key={row.id} className="border-t border-[--b1] align-top">
          <td className="py-2 pr-2"><div className="mono text-[--orange]">{row.tracking_number ?? row.id}</div><div className="mt-0.5 text-[--t2]">{row.consignee ?? "Unassigned client"}</div><div className="mt-0.5 text-[10px] text-[--t3]">{row.weight ?? "—"} kg · {fmtRelative(row.registered_at)}</div></td>
          <td>{row.pcs ?? "—"}</td><td className="mono">{row.cost == null ? "—" : fmtKES(row.cost)}</td><td className="capitalize text-[--t2]">{row.status}</td><td className="text-right">{canRelease && row.paid_at && !["collected", "released"].includes(row.status) ? <button disabled={releasing} onClick={() => onRelease(row.id)} className="text-[10px] font-bold uppercase tracking-wider text-[--green] disabled:opacity-50">Release</button> : "—"}</td>
        </tr>)}
        {!rows.length && <tr><td colSpan={5} className="py-6 text-center text-[--t3]">No packages yet.</td></tr>}
      </tbody>
    </table>
  </div>;
}

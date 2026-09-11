import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/mobile/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { fmtKES, fmtRelative } from "@/lib/format";

export const Route = createFileRoute("/packages/$id")({
  head: () => ({
    meta: [
      { title: "Package details — DEXCARGO Ops" },
      { name: "description", content: "Manifest package details: tracking number, client, pieces, weight, charge and clearing history." },
      { property: "og:title", content: "Package details — DEXCARGO Ops" },
      { property: "og:description", content: "View a cargo package registered from an Excel manifest." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <AppShell><Detail /></AppShell>,
});

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-[--b1] last:border-0">
      <span className="text-[10px] uppercase tracking-wider text-[--t3] font-bold">{label}</span>
      <span className="text-sm text-right">{value ?? "—"}</span>
    </div>
  );
}

function Detail() {
  const { id } = Route.useParams();
  const nav = useNavigate();

  const pkg = useQuery({
    queryKey: ["cargo", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("cargo_packages").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  if (pkg.isLoading) return <div className="p-6 text-sm text-[--t2]">Loading…</div>;
  if (!pkg.data) return (
    <div className="p-6 text-sm text-[--t2]">
      Package not found. <button className="text-[--orange]" onClick={() => nav({ to: "/packages" })}>Go back</button>
    </div>
  );

  const p = pkg.data;
  const columns: Record<string, unknown> = (p.manifest_data?.columns as Record<string, unknown>) ?? {};

  return (
    <div className="pb-8 px-4">
      <div className="mt-3 flex items-center gap-2">
        <span className="mono text-[12px] text-[--orange] font-semibold">{p.tracking_number ?? p.id}</span>
        <StatusPill status={p.status} />
      </div>
      <h1 className="mt-1 text-lg font-semibold">{p.consignee ?? "Unassigned client"}</h1>

      <div className="card-surface p-3 mt-4">
        <Row label="Category" value={p.cargo_category ?? "general"} />
        <Row label="Mode" value={p.mode} />
        <Row label="Route" value={`${p.origin ?? "—"} → ${p.dest ?? "—"}`} />
        <Row label="Pieces" value={p.pcs ?? "—"} />
        <Row label="Weight" value={p.weight ? `${p.weight} kg` : "—"} />
        <Row label="Volume" value={p.volume_cbm ? `${p.volume_cbm} cbm` : "—"} />
        <Row label="Charge" value={p.cost == null ? "—" : fmtKES(p.cost)} />
        <Row label="Description" value={p.description ?? p.descr} />
      </div>

      <div className="card-surface p-3 mt-3">
        <Row label="Manifest" value={p.manifest_name ?? "—"} />
        <Row label="Registered" value={fmtRelative(p.registered_at)} />
        <Row label="Paid" value={p.paid_at ? fmtRelative(p.paid_at) : "—"} />
        <Row label="Collected" value={p.collected_at ? fmtRelative(p.collected_at) : "—"} />
        <Row label="Payment ref" value={p.payment_ref ?? "—"} />
        <Row label="Sales rep" value={p.sales_rep ?? "—"} />
      </div>

      {Object.keys(columns).length > 0 && (
        <div className="card-surface p-3 mt-3">
          <div className="text-[10px] uppercase tracking-wider text-[--t3] font-bold mb-2">Manifest row</div>
          {Object.entries(columns).map(([key, value]) => (
            <Row key={key} label={key} value={value == null || value === "" ? "—" : String(value)} />
          ))}
        </div>
      )}
    </div>
  );
}

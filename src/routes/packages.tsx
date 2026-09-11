import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/mobile/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { fmtKES, fmtRelative } from "@/lib/format";
import { useState } from "react";

export const Route = createFileRoute("/packages")({
  head: () => ({
    meta: [
      { title: "Manifest Packages — DEXCARGO Ops" },
      { name: "description", content: "Browse cargo packages extracted from uploaded Excel manifests: tracking number, client, pieces, weight and charge." },
      { property: "og:title", content: "Manifest Packages — DEXCARGO Ops" },
      { property: "og:description", content: "Cargo packages registered from Excel manifests, grouped by general, special and sea cargo." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PackagesRoute,
});

function PackagesRoute() {
  const path = useLocation({ select: (l) => l.pathname });
  if (path !== "/packages") return <Outlet />;
  return <AppShell><PackagesList /></AppShell>;
}

const CATEGORIES = [
  { key: "all", label: "All" },
  { key: "general", label: "General" },
  { key: "special", label: "Special" },
  { key: "sea", label: "Sea" },
];

const STATUSES = [
  { key: "all", label: "Any status" },
  { key: "registered", label: "Registered" },
  { key: "paid", label: "Paid" },
  { key: "cleared", label: "Cleared" },
  { key: "collected", label: "Collected" },
];

function PackagesList() {
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");

  const list = useQuery({
    queryKey: ["cargo-list", category, status, q],
    queryFn: async () => {
      let query = supabase.from("cargo_packages")
        .select("id, tracking_number, consignee, cargo_category, status, pcs, weight, volume_cbm, cost, manifest_name, registered_at")
        .order("registered_at", { ascending: false })
        .limit(100);
      if (category !== "all") query = query.eq("cargo_category", category);
      if (status !== "all") query = query.eq("status", status);
      const term = q.trim();
      if (term) query = query.or(`tracking_number.ilike.%${term}%,consignee.ilike.%${term}%,id.ilike.%${term}%`);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="pb-6">
      <div className="px-4 mt-2">
        <div className="relative">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tracking # or client"
            className="w-full bg-[--s2] border border-[--b1] rounded-lg pl-10 pr-3 py-2.5 text-sm placeholder:text-[--t3] focus:outline-none focus:ring-2 focus:ring-[--ring]" />
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[--t3]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
        </div>
      </div>

      <div className="px-4 mt-3 flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {CATEGORIES.map((f) => (
          <button key={f.key} onClick={() => setCategory(f.key)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold border transition ${category === f.key ? "bg-[--blue] text-white border-transparent" : "bg-[--s2] text-[--t2] border-[--b1]"}`}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="px-4 mt-2 flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {STATUSES.map((f) => (
          <button key={f.key} onClick={() => setStatus(f.key)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold border transition ${status === f.key ? "bg-[--orange] text-[--bg] border-transparent" : "bg-[--s2] text-[--t2] border-[--b1]"}`}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="px-4 mt-4 flex flex-col gap-2">
        {(list.data ?? []).map((p: any) => (
          <Link key={p.id} to="/packages/$id" params={{ id: p.id }} className="card-surface p-3 flex items-center justify-between active:scale-[.99]">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="mono text-[11px] text-[--orange] font-semibold">{p.tracking_number ?? p.id}</span>
                <StatusPill status={p.status} />
              </div>
              <div className="mt-1 font-semibold text-sm truncate">{p.consignee ?? "Unassigned client"}</div>
              <div className="text-[10px] text-[--t3] mt-0.5">
                {p.cargo_category ?? "general"} · {p.pcs ?? "—"} pcs · {p.weight ? `${p.weight} kg` : p.volume_cbm ? `${p.volume_cbm} cbm` : "—"} · {fmtRelative(p.registered_at)}
              </div>
            </div>
            <div className="text-right shrink-0 pl-3">
              <div className="mono text-[11px]">{p.cost == null ? "—" : fmtKES(p.cost)}</div>
              <div className="text-[--t3] text-lg leading-none">›</div>
            </div>
          </Link>
        ))}
        {list.isSuccess && list.data.length === 0 && (
          <div className="text-xs text-[--t3] text-center py-8">No manifest packages match.</div>
        )}
        {list.isError && <div className="text-xs text-red-300 text-center py-8">Could not load packages.</div>}
      </div>
    </div>
  );
}

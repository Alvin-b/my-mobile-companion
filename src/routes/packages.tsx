import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/mobile/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { fmtRelative } from "@/lib/format";
import { useState } from "react";

export const Route = createFileRoute("/packages")({
  head: () => ({ meta: [{ title: "Packages — DEXCARGO Ops" }] }),
  component: PackagesRoute,
});

function PackagesRoute() {
  const path = useLocation({ select: (l) => l.pathname });
  // If child route is active, render outlet only.
  if (path !== "/packages") return <Outlet />;
  return <AppShell><PackagesList /></AppShell>;
}

const FILTERS: Array<{ key: string; label: string; status?: string }> = [
  { key: "all", label: "All" },
  { key: "received", label: "Received", status: "received" },
  { key: "awaiting_payment", label: "Awaiting", status: "awaiting_payment" },
  { key: "paid", label: "Paid", status: "paid" },
  { key: "ready_for_collection", label: "Ready", status: "ready_for_collection" },
  { key: "collected", label: "Collected", status: "collected" },
];

function PackagesList() {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");

  const list = useQuery({
    queryKey: ["pkg-list", filter, q],
    queryFn: async () => {
      let query = supabase.from("packages")
        .select("id, tracking_number, status, created_at, weight_kg, total_charges, customers(full_name, phone)")
        .order("created_at", { ascending: false })
        .limit(50);
      const status = FILTERS.find((f) => f.key === filter)?.status;
      if (status) query = query.eq("status", status as never);
      if (q.trim()) query = query.ilike("tracking_number", `%${q.trim()}%`);
      const { data } = await query;
      return data ?? [];
    },
  });

  return (
    <div className="pb-6">
      <div className="px-4 mt-2">
        <div className="relative">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tracking # or customer"
            className="w-full bg-[--s2] border border-[--b1] rounded-lg pl-10 pr-3 py-2.5 text-sm placeholder:text-[--t3] focus:outline-none focus:ring-2 focus:ring-[--ring]" />
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[--t3]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
        </div>
      </div>

      <div className="px-4 mt-3 flex gap-2 overflow-x-auto no-scrollbar -mx-1 pb-1">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold border transition ${filter === f.key ? "bg-[--blue] text-white border-transparent" : "bg-[--s2] text-[--t2] border-[--b1]"}`}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="px-4 mt-4 flex flex-col gap-2">
        {(list.data ?? []).map((p: any) => (
          <Link key={p.id} to="/packages/$id" params={{ id: p.id }} className="card-surface p-3 flex items-center justify-between active:scale-[.99]">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="mono text-[11px] text-[--orange] font-semibold">{p.tracking_number}</span>
                <StatusPill status={p.status} />
              </div>
              <div className="mt-1 font-semibold text-sm truncate">{p.customers?.full_name ?? "Unknown customer"}</div>
              <div className="text-[10px] text-[--t3] mt-0.5">{p.weight_kg ? `${p.weight_kg} kg · ` : ""}{fmtRelative(p.created_at)}</div>
            </div>
            <div className="text-[--t3] text-lg">›</div>
          </Link>
        ))}
        {list.isSuccess && list.data.length === 0 && (
          <div className="text-xs text-[--t3] text-center py-8">No packages match.</div>
        )}
      </div>
    </div>
  );
}
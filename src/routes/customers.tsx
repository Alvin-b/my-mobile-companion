import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/mobile/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";

export const Route = createFileRoute("/customers")({
  head: () => ({ meta: [{ title: "Customers — DEXCARGO Ops" }] }),
  component: () => <AppShell><Customers /></AppShell>,
});

function Customers() {
  const [q, setQ] = useState("");
  const list = useQuery({
    queryKey: ["cust", q],
    queryFn: async () => {
      let query = supabase.from("customers").select("id, full_name, phone, city, whatsapp_number").order("full_name").limit(60);
      if (q.trim()) query = query.or(`full_name.ilike.%${q.trim()}%,phone.ilike.%${q.trim()}%`);
      const { data } = await query;
      return data ?? [];
    },
  });
  return (
    <div className="px-4 pb-8">
      <div className="mt-2 relative">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or phone"
          className="w-full bg-[--s2] border border-[--b1] rounded-lg pl-10 pr-3 py-2.5 text-sm placeholder:text-[--t3] focus:outline-none focus:ring-2 focus:ring-[--ring]" />
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[--t3]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {(list.data ?? []).map((c: any) => (
          <div key={c.id} className="card-surface p-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">{c.full_name}</div>
              <div className="mono text-[11px] text-[--t2] mt-0.5">{c.phone}</div>
              <div className="text-[10px] text-[--t3] mt-0.5">{c.city ?? "Kenya"}</div>
            </div>
            {c.whatsapp_number && <div className="text-[10px] text-[--green] font-semibold uppercase tracking-wider">WhatsApp</div>}
          </div>
        ))}
        {list.isSuccess && list.data.length === 0 && <div className="text-xs text-[--t3] text-center py-6">No customers yet.</div>}
      </div>
    </div>
  );
}
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/mobile/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { fmtRelative } from "@/lib/format";

export const Route = createFileRoute("/notifications")({
  head: () => ({ meta: [{ title: "Alerts — DEXCARGO Ops" }] }),
  component: () => <AppShell><Alerts /></AppShell>,
});

function Alerts() {
  const q = useQuery({
    queryKey: ["notifs"],
    queryFn: async () => {
      const { data } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(30);
      return data ?? [];
    },
  });
  const rows = q.data ?? [];
  return (
    <div className="px-4 pb-8">
      <h2 className="mt-3 text-[11px] font-bold uppercase tracking-wider text-[--t2]">Recent alerts</h2>
      <div className="mt-2 flex flex-col gap-2">
        {rows.length === 0 && <div className="text-xs text-[--t3] text-center py-8">No notifications yet.</div>}
        {rows.map((n: any) => (
          <div key={n.id} className="card-surface p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">{n.title}</div>
              <span className="text-[10px] text-[--t3]">{fmtRelative(n.created_at)}</span>
            </div>
            {n.body && <div className="text-xs text-[--t2] mt-1">{n.body}</div>}
            <div className="text-[10px] text-[--orange] mt-1 font-semibold uppercase tracking-wider">{n.audience}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
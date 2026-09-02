import { createFileRoute } from "@tanstack/react-router";
import { verifyStaffJwt } from "@/lib/storage-sign.server";
import { runTrackingAgent, webTrackerLinks, type TrackEvent } from "@/lib/tracking.server";

// Universal package tracking for employees.
// GET /api/public/track?number=LX123456789CN
// Auth: Supabase JWT of an active staff member.
//
// Returns the internal DEXCARGO timeline for the tracking number (if we have
// the package on file) merged with whatever the external tracking agent could
// find, plus deep links to 17TRACK / ParcelsApp for manual follow-up.

export const Route = createFileRoute("/api/public/track")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await verifyStaffJwt(request);
        if (!user) return new Response("Unauthorized", { status: 401 });

        const url = new URL(request.url);
        const number = (url.searchParams.get("number") ?? url.searchParams.get("tracking_number") ?? "").trim();
        if (!number) return new Response("Missing 'number' query parameter", { status: 400 });
        if (number.length > 64) return new Response("Tracking number too long", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const normalized = number.toUpperCase().replace(/[^A-Z0-9]/g, "");

        const internalEvents: TrackEvent[] = [];
        let packageRef: Record<string, unknown> | null = null;

        const { data: cargo } = await supabaseAdmin
          .from("cargo_packages")
          .select(
            "id, tracking_number, consignee, origin, dest, mode, status, cost, registered_at, paid_at, collected_at, sales_rep, cargo_category",
          )
          .ilike("tracking_number", number)
          .order("registered_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (cargo) {
          packageRef = {
            source: "cargo_packages",
            id: cargo.id,
            tracking_number: cargo.tracking_number,
            consignee: cargo.consignee,
            origin: cargo.origin,
            destination: cargo.dest,
            mode: cargo.mode,
            category: cargo.cargo_category,
            status: cargo.status,
            cost: cargo.cost,
            sales_rep: cargo.sales_rep,
          };
          if (cargo.registered_at)
            internalEvents.push({ time: cargo.registered_at, status: "Registered at DEXCARGO", location: cargo.origin ?? null, source: "dexcargo" });
          if (cargo.paid_at)
            internalEvents.push({ time: cargo.paid_at, status: "Payment received / cleared", location: null, source: "dexcargo" });
          if (cargo.collected_at)
            internalEvents.push({ time: cargo.collected_at, status: "Collected by consignee", location: cargo.dest ?? null, source: "dexcargo" });
        } else {
          const { data: pkg } = await supabaseAdmin
            .from("packages")
            .select("id, tracking_number, status, destination_city, courier, received_at, customers(full_name)")
            .ilike("tracking_number", number)
            .limit(1)
            .maybeSingle();
          if (pkg) {
            packageRef = {
              source: "packages",
              id: pkg.id,
              tracking_number: pkg.tracking_number,
              consignee: (pkg as any).customers?.full_name ?? null,
              destination: pkg.destination_city,
              courier: pkg.courier,
              status: pkg.status,
            };
            const { data: history } = await supabaseAdmin
              .from("package_status_history")
              .select("to_status, notes, created_at")
              .eq("package_id", pkg.id)
              .order("created_at", { ascending: true });
            for (const h of history ?? []) {
              internalEvents.push({
                time: h.created_at,
                status: h.notes ? `${h.to_status} — ${h.notes}` : String(h.to_status),
                location: null,
                source: "dexcargo",
              });
            }
          }
        }

        const { winner, attempts, hits } = await runTrackingAgent(number);

        const merged = [...internalEvents, ...(winner?.events ?? [])].sort((a, b) => {
          const ta = a.time ? Date.parse(a.time) : 0;
          const tb = b.time ? Date.parse(b.time) : 0;
          return tb - ta;
        });

        return Response.json({
          tracking_number: number,
          normalized_tracking_number: normalized,
          found_in_system: Boolean(packageRef),
          package: packageRef,
          external: winner
            ? { provider: winner.provider, carrier: winner.carrier ?? null, status: winner.status ?? null, event_count: winner.events.length }
            : null,
          external_matches: hits.map((h) => ({
            provider: h.provider,
            carrier: h.carrier ?? null,
            status: h.status ?? null,
            event_count: h.events.length,
            events: h.events,
          })),
          latest_status: merged[0]?.status ?? (packageRef?.["status"] as string | undefined) ?? null,
          events: merged,
          providers_tried: attempts.map((a) => ({ provider: a.provider, ok: a.ok, events: a.events.length, note: a.note ?? null })),
          manual_lookup: webTrackerLinks(number),

          generated_at: new Date().toISOString(),
        });
      },
    },
  },
});

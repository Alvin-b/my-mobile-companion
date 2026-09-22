import { createFileRoute } from "@tanstack/react-router";
import { verifyStaffJwt } from "@/lib/storage-sign.server";

// Links one uploaded payment evidence (payment_notification) to ONE OR MANY
// cargo packages. Each allocation row fires the `on_payment_allocation_insert`
// trigger, which marks the package paid, stamps paid_at/payment_ref and lets
// the commission trigger award the employee that owns the package.
//
// Auth: Supabase JWT of an active staff member.
// POST /api/public/link-payment
// { "payment_notification_id": "PN-1",
//   "allocations": [ { "package_id": "DXC...", "amount": 5000 } ] }

type AllocationInput = { package_id?: string; order_id?: string; tracking_number?: string; amount?: number };

export const Route = createFileRoute("/api/public/link-payment")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await verifyStaffJwt(request);
        if (!user) return new Response("Unauthorized", { status: 401 });

        let body: { payment_notification_id?: string; allocations?: AllocationInput[]; linked_by?: string };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const notificationId = (body.payment_notification_id ?? "").trim();
        const inputs = (body.allocations ?? []).filter(Boolean);
        if (!notificationId) return Response.json({ error: "payment_notification_id is required" }, { status: 400 });
        if (inputs.length === 0) return Response.json({ error: "At least one allocation is required" }, { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: notification, error: notificationError } = await supabaseAdmin
          .from("payment_notifications")
          .select("id, notification_number, amount, status")
          .eq("id", notificationId)
          .maybeSingle();
        if (notificationError) return Response.json({ error: notificationError.message }, { status: 500 });
        if (!notification) return Response.json({ error: "Payment evidence not found" }, { status: 404 });

        // Resolve every target package before writing anything.
        const targets: { id: string; cost: number | null; requested: number | null }[] = [];
        const targetIds = new Set<string>();
        for (const input of inputs) {
          const key = (input.package_id ?? input.order_id ?? input.tracking_number ?? "").trim();
          if (!key) return Response.json({ error: "Every allocation needs a package_id" }, { status: 400 });
          const { data: pkg } = await supabaseAdmin
            .from("cargo_packages")
            .select("id, cost, tracking_number, mode, registered_at")
            .or(`id.eq.${key},tracking_number.eq.${key}`)
            .order("registered_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          if (!pkg) return Response.json({ error: `No package found for "${key}"` }, { status: 404 });
          const requested = input.amount == null ? null : Number(input.amount);
          if (requested != null && (!isFinite(requested) || requested <= 0)) {
            return Response.json({ error: `Invalid amount for package ${key}` }, { status: 400 });
          }
          if (targetIds.has(pkg.id)) return Response.json({ error: `Package "${key}" was selected more than once` }, { status: 400 });
          targetIds.add(pkg.id);
          targets.push({ id: pkg.id, cost: pkg.cost == null ? null : Number(pkg.cost), requested });
        }

        // Amounts default to the package cost; the evidence total is split
        // evenly when neither an explicit amount nor a cost is known.
        const evidenceTotal = notification.amount == null ? null : Number(notification.amount);
        const fallbackShare = evidenceTotal == null ? 0 : evidenceTotal / targets.length;
        const rows = targets.map((t) => ({
          amount: t.requested ?? (t.cost && t.cost > 0 ? t.cost : fallbackShare),
          id: t.id,
        }));
        const allocatedTotal = rows.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
        if (evidenceTotal != null && allocatedTotal - evidenceTotal > 0.01) {
          return Response.json(
            { error: `Allocations (${allocatedTotal}) exceed the evidence amount (${evidenceTotal})` },
            { status: 400 },
          );
        }

        const stamp = Date.now();
        const inserted: string[] = [];
        for (const [index, row] of rows.entries()) {
          const { error } = await supabaseAdmin.from("payment_allocations").insert({
            id: `PA-${stamp}-${index + 1}`,
            payment_notification_id: notification.id,
            order_id: row.id,
            tracking_number: row.id,
            allocated_amount: row.amount ?? 0,
            notification_number: notification.notification_number,
            linked_by: user.email ?? user.id,
          });
          if (error) return Response.json({ error: error.message, linked: inserted }, { status: 400 });
          inserted.push(row.id);
        }

        // The SQL trigger also performs this update, but doing it here makes
        // the API contract explicit and supports installations that have not
        // yet refreshed their trigger definition.  Paid is the only settled
        // status exposed by DEX; it is the same business state as "cleared".
        const { error: paidError } = await supabaseAdmin
          .from("cargo_packages")
          .update({ status: "paid", paid_at: new Date().toISOString(), payment_ref: notification.notification_number ?? notification.id, payment_method: "payment_evidence" })
          .in("id", inserted)
          .not("status", "in", "(collected,released)");
        if (paidError) return Response.json({ error: paidError.message, linked: inserted }, { status: 400 });

        // Do not rely only on an installation's database trigger for this
        // visible queue state.  Once allocations were accepted, the evidence
        // is no longer actionable and belongs in the linked-evidence archive.
        const { error: linkedEvidenceError } = await supabaseAdmin
          .from("payment_notifications")
          .update({ status: "LINKED", updated_at: new Date().toISOString() })
          .eq("id", notification.id);
        if (linkedEvidenceError) return Response.json({ error: linkedEvidenceError.message, linked: inserted }, { status: 400 });

        const { data: updated } = await supabaseAdmin
          .from("cargo_packages")
          .select("id, status, cost, paid_at, payment_ref, sales_rep")
          .in("id", inserted);

        return Response.json(
          {
            ok: true,
            payment_notification_id: notification.id,
            allocated_total: allocatedTotal,
            packages: updated ?? [],
          },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { verifyStaffJwt, signPath } from "@/lib/storage-sign.server";

// Returns the REAL uploaded payment evidence for one or more payment
// notifications. Evidence images live in the private `proofs` bucket, so the
// stored `image_url` (e.g. "proofs/proof_123.jpg") is NOT directly loadable by
// the mobile app — this endpoint issues a short-lived signed URL instead.
//
// Evidence can be: an image only, an image + a typed note, or text only.
// The response always exposes both `evidence_url` and `note`, plus an
// `evidence_kind` of "image" | "text" | "image_and_text" | "none" so the app
// can render whichever parts exist without guessing.
//
// Auth: Supabase JWT of an active staff member.
// GET  /api/public/payment-evidence?id=PN-123               -> single record
// GET  /api/public/payment-evidence?status=PENDING&limit=50 -> list
// GET  /api/public/payment-evidence?order_id=<cargo id>     -> linked to a package

export const Route = createFileRoute("/api/public/payment-evidence")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await verifyStaffJwt(request);
        if (!user) return new Response("Unauthorized", { status: 401 });

        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        const status = url.searchParams.get("status");
        const orderId = url.searchParams.get("order_id");
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        let ids: string[] | null = null;
        if (orderId) {
          const { data: allocs } = await supabaseAdmin
            .from("payment_allocations")
            .select("payment_notification_id")
            .eq("order_id", orderId);
          ids = (allocs ?? []).map((a) => a.payment_notification_id);
          if (ids.length === 0) {
            return Response.json({ evidence: [], count: 0 }, { headers: { "cache-control": "no-store" } });
          }
        }

        let query = supabaseAdmin
          .from("payment_notifications")
          .select(
            "id, notification_number, evidence_type, image_url, text_content, uploaded_by, uploaded_at, status, amount, sender_phone, mpesa_receipt, timestamp",
          )
          .order("uploaded_at", { ascending: false })
          .limit(limit);
        if (id) query = query.eq("id", id);
        if (status) query = query.eq("status", status);
        if (ids) query = query.in("id", ids);

        const { data, error } = await query;
        if (error) return new Response(error.message, { status: 500 });

        const rows = await Promise.all(
          (data ?? []).map(async (row) => {
            const evidenceUrl = await signPath(row.image_url, "proofs");
            const note = (row.text_content ?? "").trim() || null;
            const kind = evidenceUrl
              ? note
                ? "image_and_text"
                : "image"
              : note
                ? "text"
                : "none";

            // Every package this evidence has been linked to, so the app can
            // open one evidence and see exactly what it cleared.
            const { data: allocations } = await supabaseAdmin
              .from("payment_allocations")
              .select("id, order_id, allocated_amount, linked_by, linked_at")
              .eq("payment_notification_id", row.id)
              .order("linked_at", { ascending: true });
            const packageIds = [...new Set((allocations ?? []).map((a) => a.order_id))];
            const { data: pkgs } = packageIds.length
              ? await supabaseAdmin
                  .from("cargo_packages")
                  .select("id, tracking_number, consignee, status, cost, paid_at, payment_ref, sales_rep, dest, mode")
                  .in("id", packageIds)
              : { data: [] as any[] };
            const linkedPackages = (allocations ?? []).map((a) => {
              const pkg = (pkgs ?? []).find((p) => p.id === a.order_id);
              return {
                allocation_id: a.id,
                package_id: a.order_id,
                allocated_amount: Number(a.allocated_amount ?? 0),
                linked_by: a.linked_by,
                linked_at: a.linked_at,
                tracking_number: pkg?.tracking_number ?? a.order_id,
                consignee: pkg?.consignee ?? null,
                status: pkg?.status ?? null,
                cost: pkg?.cost == null ? null : Number(pkg.cost),
                paid_at: pkg?.paid_at ?? null,
                payment_ref: pkg?.payment_ref ?? null,
                sales_rep: pkg?.sales_rep ?? null,
                dest: pkg?.dest ?? null,
                mode: pkg?.mode ?? null,
              };
            });

            return {
              ...row,
              evidence_url: evidenceUrl,
              has_image: !!evidenceUrl,
              note,
              has_note: !!note,
              evidence_kind: kind,
              linked_packages: linkedPackages,
              linked_package_count: linkedPackages.length,
              allocated_total: linkedPackages.reduce((s, p) => s + p.allocated_amount, 0),
            };
          }),
        );

        return Response.json(
          id ? { evidence: rows[0] ?? null } : { evidence: rows, count: rows.length },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});

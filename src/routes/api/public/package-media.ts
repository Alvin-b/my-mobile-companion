import { createFileRoute } from "@tanstack/react-router";
import { verifyStaffJwt, signPath } from "@/lib/storage-sign.server";

// Real package photos for the mobile app.
// Photos live in the private `package-photos` / `sticker-photos` buckets, so the
// stored value is a path, not a loadable URL. This returns signed 1h URLs.
//
// Auth: Supabase JWT of a signed-in staff member.
// GET /api/public/package-media?id=<cargo_package_id>
// GET /api/public/package-media?tracking_number=DEX-123
// GET /api/public/package-media?limit=50            -> most recent packages

export const Route = createFileRoute("/api/public/package-media")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await verifyStaffJwt(request);
        if (!user) return new Response("Unauthorized", { status: 401 });

        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        const tracking = url.searchParams.get("tracking_number");
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        let q = supabaseAdmin
          .from("cargo_packages")
          .select(
            "id, consignee, phone, status, package_photo_url, package_photo_captured_at, package_photo_captured_by, signature_points, registered_at",
          )
          .order("registered_at", { ascending: false })
          .limit(limit);
        if (id) q = q.eq("id", id);
        if (tracking) q = q.eq("id", tracking);

        const { data, error } = await q;
        if (error) return new Response(error.message, { status: 500 });

        const rows = await Promise.all(
          (data ?? []).map(async (row) => ({
            ...row,
            photo_url: await signPath(row.package_photo_url, "package-photos"),
          })),
        );

        // Extra images attached to warehouse packages (stickers, proofs, QR).
        let images: unknown[] = [];
        if (id) {
          const { data: imgs } = await supabaseAdmin
            .from("package_images")
            .select("id, package_id, kind, url, created_at")
            .eq("package_id", id);
          images = await Promise.all(
            (imgs ?? []).map(async (i) => ({
              ...i,
              signed_url: await signPath(
                i.url,
                i.kind === "sticker" ? "sticker-photos" : i.kind === "signature" ? "signatures" : "package-photos",
              ),
            })),
          );
        }

        return Response.json(
          id || tracking
            ? { package: rows[0] ?? null, images }
            : { packages: rows, count: rows.length },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";

// Returns the REAL uploaded payment evidence for one or more payment
// notifications. Evidence images live in the private `proofs` bucket, so the
// stored `image_url` (e.g. "proofs/proof_123.jpg") is NOT directly loadable by
// the mobile app — this endpoint issues a short-lived signed URL instead.
//
// Auth: Supabase JWT of an active staff member.
// GET  /api/public/payment-evidence?id=PN-123            -> single record
// GET  /api/public/payment-evidence?status=PENDING&limit=50 -> list

const BUCKETS = ["proofs", "package-photos", "sticker-photos", "signatures"];

async function verifySupabaseJwt(token: string) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const r = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  return (await r.json()) as { id: string };
}

function splitPath(raw: string): { bucket: string; path: string } {
  const clean = raw.replace(/^\/+/, "");
  const first = clean.split("/")[0] ?? "";
  if (BUCKETS.includes(first)) {
    return { bucket: first, path: clean.slice(first.length + 1) };
  }
  return { bucket: "proofs", path: clean };
}

export const Route = createFileRoute("/api/public/payment-evidence")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        const user = token ? await verifySupabaseJwt(token) : null;
        if (!user) return new Response("Unauthorized", { status: 401 });

        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        const status = url.searchParams.get("status");
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        let query = supabaseAdmin
          .from("payment_notifications")
          .select(
            "id, notification_number, evidence_type, image_url, text_content, uploaded_by, uploaded_at, status, amount, sender_phone, mpesa_receipt, timestamp",
          )
          .order("uploaded_at", { ascending: false })
          .limit(limit);
        if (id) query = query.eq("id", id);
        if (status) query = query.eq("status", status);

        const { data, error } = await query;
        if (error) return new Response(error.message, { status: 500 });

        const rows = await Promise.all(
          (data ?? []).map(async (row) => {
            let signed: string | null = null;
            if (row.image_url) {
              if (/^https?:\/\//i.test(row.image_url)) {
                signed = row.image_url;
              } else {
                const { bucket, path } = splitPath(row.image_url);
                const { data: s } = await supabaseAdmin.storage
                  .from(bucket)
                  .createSignedUrl(path, 60 * 60);
                signed = s?.signedUrl ?? null;
              }
            }
            return { ...row, evidence_url: signed };
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
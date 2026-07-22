import { createFileRoute } from "@tanstack/react-router";

// Outbound SMS / WhatsApp notification to a consignee.
// Auth: Supabase JWT of an active staff member.
// Provider: Twilio if TWILIO_* secrets are configured, otherwise the request
//   is queued as a whatsapp_log row with status 'queued' for manual review.
//
// Body: { "to": "+2547XXXXXXXX", "message": "...", "package_id": "opt" }

async function verifySupabaseJwt(token: string) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const r = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  return (await r.json()) as { id: string; email?: string };
}

export const Route = createFileRoute("/api/public/send-sms")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        const user = token ? await verifySupabaseJwt(token) : null;
        if (!user) return new Response("Unauthorized", { status: 401 });

        const body = (await request.json().catch(() => null)) as
          | { to?: string; message?: string; package_id?: string }
          | null;
        if (!body?.to || !body.message) {
          return new Response("to and message required", { status: 400 });
        }

        const sid = process.env.TWILIO_ACCOUNT_SID;
        const twToken = process.env.TWILIO_AUTH_TOKEN;
        const from = process.env.TWILIO_FROM_NUMBER;

        let providerStatus = "queued";
        let providerRef: string | null = null;
        let errorText: string | null = null;

        if (sid && twToken && from) {
          const form = new URLSearchParams({
            To: body.to,
            From: from,
            Body: body.message,
          });
          const resp = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
            {
              method: "POST",
              headers: {
                Authorization:
                  "Basic " + Buffer.from(`${sid}:${twToken}`).toString("base64"),
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: form,
            },
          );
          const data = (await resp.json().catch(() => ({}))) as {
            sid?: string;
            message?: string;
          };
          if (resp.ok) {
            providerStatus = "sent";
            providerRef = data.sid ?? null;
          } else {
            providerStatus = "failed";
            errorText = data.message ?? `HTTP ${resp.status}`;
          }
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        await supabaseAdmin.from("whatsapp_logs").insert({
          to_phone: body.to,
          message: body.message,
          status: providerStatus,
          provider_ref: providerRef,
          error: errorText,
          package_id: body.package_id ?? null,
          sent_by: user.id,
        });

        return Response.json({ ok: providerStatus !== "failed", status: providerStatus, ref: providerRef, error: errorText });
      },
    },
  },
});
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Authenticated HTTP endpoint for the Android app.
// Header: Authorization: Bearer <supabase_access_token>
// Body:   { phone, amount, tracking_number, description? }
// Behavior mirrors src/lib/mpesa.functions.ts::initiateMpesaStkPush.

const Input = z.object({
  phone: z.string().min(9),
  amount: z.number().int().positive(),
  tracking_number: z.string().min(1),
  description: z.string().max(60).optional(),
});

function normalizePhone(raw: string): string {
  let p = raw.replace(/\s|-/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("0")) p = "254" + p.slice(1);
  if (p.startsWith("7") || p.startsWith("1")) p = "254" + p;
  return p;
}

function tsNow(): string {
  const d = new Date();
  const p = (n: number) => n.toString().padStart(2, "0");
  return (
    d.getUTCFullYear() +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds())
  );
}

async function verifySupabaseJwt(token: string): Promise<{ id: string } | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const r = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  return (await r.json()) as { id: string };
}

export const Route = createFileRoute("/api/mpesa-stk-push")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        const user = token ? await verifySupabaseJwt(token) : null;
        if (!user) return new Response("Unauthorized", { status: 401 });

        const body = await request.json().catch(() => null);
        const parsed = Input.safeParse(body);
        if (!parsed.success) {
          return Response.json({ error: parsed.error.message }, { status: 400 });
        }

        // The tracking number is the shared identifier used by Android and the
        // companion app. Do not send a charge for an unknown or already closed
        // package, and never let the caller choose a different amount.
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: pkg, error: packageError } = await supabaseAdmin
          .from("packages")
          .select("id, amount_due, status")
          .eq("tracking_number", parsed.data.tracking_number)
          .maybeSingle();
        if (packageError) return Response.json({ error: packageError.message }, { status: 500 });
        if (!pkg) return Response.json({ error: "Unknown tracking number" }, { status: 404 });
        if (pkg.status !== "awaiting_payment") {
          return Response.json({ error: "Package is not awaiting payment" }, { status: 409 });
        }
        if (Number(pkg.amount_due) !== parsed.data.amount) {
          return Response.json({ error: "Amount must equal the package amount due" }, { status: 400 });
        }

        const env = process.env.MPESA_ENV ?? "sandbox";
        const base =
          env === "production"
            ? "https://api.safaricom.co.ke"
            : "https://sandbox.safaricom.co.ke";

        const shortcode = process.env.MPESA_SHORTCODE;
        const passkey = process.env.MPESA_PASSKEY;
        const consumerKey = process.env.MPESA_CONSUMER_KEY;
        const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
        const callbackUrl = process.env.MPESA_CALLBACK_URL;
        const partyB = process.env.MPESA_PARTY_B || shortcode;
        const accountRefEnv = process.env.MPESA_ACCOUNT_REFERENCE;

        if (!shortcode || !passkey || !consumerKey || !consumerSecret || !callbackUrl) {
          return Response.json({ error: "M-Pesa not configured" }, { status: 500 });
        }

        const phone = normalizePhone(parsed.data.phone);
        if (!/^254(7|1)\d{8}$/.test(phone)) {
          return Response.json({ error: `Invalid Safaricom phone: ${parsed.data.phone}` }, { status: 400 });
        }
        const accountRef = accountRefEnv || parsed.data.tracking_number;

        // OAuth
        const tokenRes = await fetch(
          `${base}/oauth/v1/generate?grant_type=client_credentials`,
          { headers: { Authorization: `Basic ${btoa(`${consumerKey}:${consumerSecret}`)}` } },
        );
        if (!tokenRes.ok) {
          const t = await tokenRes.text();
          return Response.json({ error: `Daraja OAuth failed: ${t}` }, { status: 502 });
        }
        const { access_token } = (await tokenRes.json()) as { access_token: string };

        const timestamp = tsNow();
        const password = btoa(`${shortcode}${passkey}${timestamp}`);
        const stkRes = await fetch(`${base}/mpesa/stkpush/v1/processrequest`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            BusinessShortCode: shortcode,
            Password: password,
            Timestamp: timestamp,
            TransactionType: "CustomerPayBillOnline",
            Amount: Math.ceil(parsed.data.amount),
            PartyA: phone,
            PartyB: partyB,
            PhoneNumber: phone,
            CallBackURL: callbackUrl,
            AccountReference: accountRef.slice(0, 12),
            TransactionDesc: (parsed.data.description ?? `Payment ${parsed.data.tracking_number}`).slice(0, 13),
          }),
        });
        const stkJson = (await stkRes.json().catch(() => ({}))) as {
          MerchantRequestID?: string;
          CheckoutRequestID?: string;
          ResponseCode?: string;
          ResponseDescription?: string;
          CustomerMessage?: string;
          errorMessage?: string;
        };
        if (!stkRes.ok || stkJson.ResponseCode !== "0") {
          return Response.json(
            { error: stkJson.errorMessage ?? stkJson.ResponseDescription ?? "STK push failed" },
            { status: 502 },
          );
        }

        const notifNumber = `PAY-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${(stkJson.CheckoutRequestID ?? "").slice(-6) || Math.floor(Math.random() * 9999).toString().padStart(4, "0")}`;
        const notifId = `PN-${crypto.randomUUID().slice(0, 8)}`;

        const { error: insErr } = await supabaseAdmin.from("payment_notifications").insert({
          id: notifId,
          notification_number: notifNumber,
          evidence_type: "TEXT",
          text_content: `STK push to ${phone} for ${parsed.data.amount} (${parsed.data.tracking_number})`,
          uploaded_by: `USER:${user.id}`,
          status: "PENDING",
          amount: parsed.data.amount,
          sender_phone: phone,
          checkout_request_id: stkJson.CheckoutRequestID,
          merchant_request_id: stkJson.MerchantRequestID,
          account_reference: accountRef,
          timestamp: new Date().toISOString(),
        });
        if (insErr) return Response.json({ error: insErr.message }, { status: 500 });

        return Response.json({
          ok: true,
          notification_id: notifId,
          notification_number: notifNumber,
          checkout_request_id: stkJson.CheckoutRequestID,
          merchant_request_id: stkJson.MerchantRequestID,
          customer_message: stkJson.CustomerMessage,
        });
      },
    },
  },
});

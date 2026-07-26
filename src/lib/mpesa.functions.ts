import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Daraja M-Pesa STK Push initiator.
// Authenticated staff (mobile app) call this to prompt a customer's phone.
// Safaricom later POSTs the result to /api/public/mpesa-webhook, which
// matches the callback back to the row we insert here via checkout_request_id.

const Input = z.object({
  phone: z.string().min(9),                 // 07XX, +2547XX, or 2547XX
  amount: z.number().int().positive(),      // KES, whole shillings
  tracking_number: z.string().min(1),       // packages.tracking_number
  description: z.string().max(60).optional(),
});

function normalizePhone(raw: string): string {
  let p = raw.replace(/\s|-/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("0")) p = "254" + p.slice(1);
  if (p.startsWith("7") || p.startsWith("1")) p = "254" + p;
  return p;
}

function daraja(env: string) {
  return env === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
}

function tsNow(): string {
  const d = new Date();
  const p = (n: number) => n.toString().padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds())
  );
}

function b64(s: string): string {
  // btoa is available on the Worker runtime
  return btoa(s);
}

export const initiateMpesaStkPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const env = process.env.MPESA_ENV ?? "sandbox";
    const shortcode = process.env.MPESA_SHORTCODE;
    const passkey = process.env.MPESA_PASSKEY;
    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    const callbackUrl = process.env.MPESA_CALLBACK_URL;
    const partyB = process.env.MPESA_PARTY_B || shortcode;
    const accountRefEnv = process.env.MPESA_ACCOUNT_REFERENCE;

    if (!shortcode || !passkey || !consumerKey || !consumerSecret || !callbackUrl) {
      throw new Error(
        "M-Pesa not configured: set MPESA_SHORTCODE, MPESA_PASSKEY, MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_CALLBACK_URL",
      );
    }

    const phone = normalizePhone(data.phone);
    if (!/^2547\d{8}$/.test(phone) && !/^2541\d{8}$/.test(phone)) {
      throw new Error(`Invalid Safaricom phone: ${data.phone}`);
    }
    const accountRef = accountRefEnv || data.tracking_number;

    // Keep this test/server-function path subject to the same canonical
    // package and amount checks as the Android HTTP endpoint.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: pkg, error: packageError } = await supabaseAdmin
      .from("packages")
      .select("amount_due, status")
      .eq("tracking_number", data.tracking_number)
      .maybeSingle();
    if (packageError) throw new Error(packageError.message);
    if (!pkg) throw new Error("Unknown tracking number");
    if (pkg.status !== "awaiting_payment") throw new Error("Package is not awaiting payment");
    if (Number(pkg.amount_due) !== data.amount) throw new Error("Amount must equal the package amount due");

    // 1) OAuth token
    const auth = b64(`${consumerKey}:${consumerSecret}`);
    const tokenRes = await fetch(
      `${daraja(env)}/oauth/v1/generate?grant_type=client_credentials`,
      { headers: { Authorization: `Basic ${auth}` } },
    );
    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      throw new Error(`Daraja OAuth failed [${tokenRes.status}]: ${t}`);
    }
    const { access_token } = (await tokenRes.json()) as { access_token: string };

    // 2) STK Push
    const timestamp = tsNow();
    const password = b64(`${shortcode}${passkey}${timestamp}`);
    const stkRes = await fetch(`${daraja(env)}/mpesa/stkpush/v1/processrequest`, {
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
        Amount: Math.ceil(data.amount),
        PartyA: phone,
        PartyB: partyB,
        PhoneNumber: phone,
        CallBackURL: callbackUrl,
        AccountReference: accountRef.slice(0, 12),
        TransactionDesc: (data.description ?? `Payment ${data.tracking_number}`).slice(0, 13),
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
      throw new Error(
        `STK push failed: ${stkJson.errorMessage ?? stkJson.ResponseDescription ?? stkRes.statusText}`,
      );
    }

    // 3) Persist a pending payment_notification so the webhook can match
    const notifNumber = `PAY-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${(stkJson.CheckoutRequestID ?? "").slice(-6) || Math.floor(Math.random() * 9999).toString().padStart(4, "0")}`;
    const notifId = `PN-${crypto.randomUUID().slice(0, 8)}`;

    const { error: insErr } = await supabaseAdmin.from("payment_notifications").insert({
      id: notifId,
      notification_number: notifNumber,
      evidence_type: "TEXT",
      text_content: `STK push to ${phone} for ${data.amount} (${data.tracking_number})`,
      uploaded_by: `USER:${context.userId}`,
      status: "PENDING",
      amount: data.amount,
      sender_phone: phone,
      checkout_request_id: stkJson.CheckoutRequestID,
      merchant_request_id: stkJson.MerchantRequestID,
      account_reference: accountRef,
      timestamp: new Date().toISOString(),
    });
    if (insErr) throw new Error(`Failed to record STK request: ${insErr.message}`);

    return {
      ok: true,
      notification_id: notifId,
      notification_number: notifNumber,
      checkout_request_id: stkJson.CheckoutRequestID,
      merchant_request_id: stkJson.MerchantRequestID,
      customer_message: stkJson.CustomerMessage,
    };
  });

// Poll status of a previously initiated STK push.
export const getMpesaStkStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ notification_id: z.string() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: notif, error } = await supabaseAdmin
      .from("payment_notifications")
      .select("id, status, mpesa_receipt, result_code, result_desc, amount, sender_phone, checkout_request_id, account_reference")
      .eq("id", data.notification_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return notif;
  });

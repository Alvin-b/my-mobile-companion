import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// M-Pesa Daraja C2B / STK Push callback receiver.
// Configure the Safaricom Daraja portal to POST here with header
//   X-Webhook-Secret: <MPESA_WEBHOOK_SECRET>
// (Daraja itself doesn't sign requests; a shared secret in the URL query
//  or header is the accepted pattern.)

const StkCallback = z.object({
  Body: z.object({
    stkCallback: z.object({
      MerchantRequestID: z.string().optional(),
      CheckoutRequestID: z.string().optional(),
      ResultCode: z.number(),
      ResultDesc: z.string().optional(),
      CallbackMetadata: z
        .object({
          Item: z.array(
            z.object({
              Name: z.string(),
              Value: z.union([z.string(), z.number()]).optional(),
            }),
          ),
        })
        .optional(),
    }),
  }),
});

function pick(items: Array<{ Name: string; Value?: string | number }>, name: string) {
  return items.find((i) => i.Name === name)?.Value;
}

export const Route = createFileRoute("/api/public/mpesa-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.MPESA_WEBHOOK_SECRET;
        if (!secret) {
          return new Response("Server misconfigured", { status: 500 });
        }
        const url = new URL(request.url);
        const provided =
          request.headers.get("x-webhook-secret") ?? url.searchParams.get("secret");
        if (provided !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }

        const raw = await request.text();
        let payload: unknown;
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const parsed = StkCallback.safeParse(payload);
        if (!parsed.success) {
          // Store as raw text notification for manual review
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );
          const num = `PAY-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 9999).toString().padStart(4, "0")}`;
          await supabaseAdmin.from("payment_notifications").insert({
            id: `PN-${crypto.randomUUID().slice(0, 8)}`,
            notification_number: num,
            evidence_type: "TEXT",
            text_content: raw,
            uploaded_by: "MPESA_WEBHOOK",
            status: "PENDING",
          });
          return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
        }

        const cb = parsed.data.Body.stkCallback;
        const items = cb.CallbackMetadata?.Item ?? [];
        const amount = Number(pick(items, "Amount") ?? 0);
        const receipt = String(pick(items, "MpesaReceiptNumber") ?? "");
        const phone = String(pick(items, "PhoneNumber") ?? "");
        const accountRef = String(pick(items, "AccountReference") ?? "");
        const checkoutRequestId = cb.CheckoutRequestID ?? "";

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        // If we initiated this via STK Push, a pending payment_notification
        // already exists keyed by checkout_request_id — update it in place.
        if (checkoutRequestId) {
          const { data: existing } = await supabaseAdmin
            .from("payment_notifications")
            .select("id, notification_number, account_reference")
            .eq("checkout_request_id", checkoutRequestId)
            .maybeSingle();

          if (existing) {
            if (cb.ResultCode !== 0) {
              await supabaseAdmin
                .from("payment_notifications")
                .update({
                  status: "FAILED",
                  result_code: cb.ResultCode,
                  result_desc: cb.ResultDesc ?? null,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", existing.id);
              return Response.json({ ResultCode: 0, ResultDesc: "Received" });
            }

            await supabaseAdmin
              .from("payment_notifications")
              .update({
                result_code: 0,
                result_desc: cb.ResultDesc ?? "Success",
                mpesa_receipt: receipt,
                amount: amount || undefined,
                sender_phone: phone || undefined,
                text_content: `M-Pesa ${receipt} KES ${amount} from ${phone} ref ${accountRef}`,
                updated_at: new Date().toISOString(),
              })
              .eq("id", existing.id);

            const ref = existing.account_reference || accountRef;
            if (ref) {
              const { data: pkg } = await supabaseAdmin
                .from("cargo_packages")
                .select("id, status")
                .eq("id", ref)
                .maybeSingle();
              if (pkg && pkg.status !== "collected") {
                await supabaseAdmin.from("payment_allocations").insert({
                  id: `PA-${crypto.randomUUID().slice(0, 8)}`,
                  payment_notification_id: existing.id,
                  order_id: pkg.id,
                  tracking_number: pkg.id,
                  allocated_amount: amount,
                  linked_by: "MPESA_WEBHOOK",
                  notification_number: existing.notification_number,
                });
              }
            }
            return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
          }
        }

        // Unmatched callback (e.g. C2B without prior STK push) — fall through
        // and insert a fresh notification for manual review.
        if (cb.ResultCode !== 0) {
          console.log("[mpesa-webhook] non-success:", cb.ResultCode, cb.ResultDesc);
          return Response.json({ ResultCode: 0, ResultDesc: "Received" });
        }

        const num = `PAY-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${(receipt || Math.floor(Math.random() * 9999).toString()).slice(-6)}`;

        const { data: notif, error: notifErr } = await supabaseAdmin
          .from("payment_notifications")
          .insert({
            id: `PN-${crypto.randomUUID().slice(0, 8)}`,
            notification_number: num,
            evidence_type: "TEXT",
            text_content: `M-Pesa ${receipt} KES ${amount} from ${phone} ref ${accountRef}`,
            uploaded_by: "MPESA_WEBHOOK",
            status: "PENDING",
            amount,
            sender_phone: phone,
            timestamp: new Date().toISOString(),
            checkout_request_id: checkoutRequestId || null,
            merchant_request_id: cb.MerchantRequestID ?? null,
            account_reference: accountRef || null,
            mpesa_receipt: receipt || null,
            result_code: 0,
            result_desc: cb.ResultDesc ?? "Success",
          })
          .select()
          .single();

        if (notifErr) {
          console.error("[mpesa-webhook] insert failed", notifErr);
          return new Response("db error", { status: 500 });
        }

        // Auto-allocate when the AccountReference matches a tracking number.
        if (accountRef) {
          const { data: pkg } = await supabaseAdmin
            .from("cargo_packages")
            .select("id, status")
            .eq("id", accountRef)
            .maybeSingle();
          if (pkg && pkg.status !== "collected") {
            await supabaseAdmin.from("payment_allocations").insert({
              id: `PA-${crypto.randomUUID().slice(0, 8)}`,
              payment_notification_id: notif.id,
              order_id: pkg.id,
              tracking_number: pkg.id,
              allocated_amount: amount,
              linked_by: "MPESA_WEBHOOK",
              notification_number: num,
            });
          }
        }

        return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
      },
    },
  },
});
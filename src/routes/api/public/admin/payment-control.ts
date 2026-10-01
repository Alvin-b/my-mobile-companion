import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireActiveAdmin } from "@/lib/admin-api.server";
import { ApiError } from "@/lib/admin-api";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const correctionInput = z.object({
  payment_notification_id: z.string().min(1),
  amount: z.number().finite().nonnegative().nullable().optional(),
  sender_phone: z.string().trim().max(40).nullable().optional(),
  text_content: z.string().max(5000).nullable().optional(),
  reason: z.string().trim().min(5).max(1000),
});

function responseError(error: unknown) {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError) return Response.json({ error: error.issues.map((issue) => issue.message).join("; ") }, { status: 400 });
  console.error("[admin/payment-control]", error);
  return Response.json({ error: "Unable to update the payment record" }, { status: 500 });
}

export const Route = createFileRoute("/api/public/admin/payment-control")({
  server: { handlers: {
    DELETE: async ({ request }) => {
      try {
        const actor = await requireActiveAdmin(request);
        const input = z.object({
          allocation_id: z.string().trim().min(1),
          reason: z.string().trim().min(5).max(1000),
        }).parse(await request.json());
        const { data, error } = await supabaseAdmin.rpc("admin_unlink_payment_allocation", {
          _allocation_id: input.allocation_id,
          _actor_employee_id: actor.employee.id,
          _reason: input.reason,
        });
        if (error) throw new ApiError(400, error.message);
        return Response.json({ ok: true, result: data }, { headers: { "cache-control": "no-store" } });
      } catch (error) { return responseError(error); }
    },
    PATCH: async ({ request }) => {
      try {
        const actor = await requireActiveAdmin(request);
        const input = correctionInput.parse(await request.json());
        const { data: before, error: readError } = await supabaseAdmin.from("payment_notifications")
          .select("id,notification_number,evidence_type,image_url,text_content,amount,sender_phone,status,uploaded_at")
          .eq("id", input.payment_notification_id).maybeSingle();
        if (readError) throw new ApiError(500, readError.message);
        if (!before) throw new ApiError(404, "Payment evidence was not found");
        const patch: Record<string, unknown> = {};
        if (Object.prototype.hasOwnProperty.call(input, "amount")) patch.amount = input.amount;
        if (Object.prototype.hasOwnProperty.call(input, "sender_phone")) patch.sender_phone = input.sender_phone;
        if (Object.prototype.hasOwnProperty.call(input, "text_content")) patch.text_content = input.text_content;
        if (!Object.keys(patch).length) throw new ApiError(400, "No payment fields were supplied for correction");
        const { data: after, error: updateError } = await supabaseAdmin.from("payment_notifications").update(patch)
          .eq("id", input.payment_notification_id).select("id,notification_number,evidence_type,image_url,text_content,amount,sender_phone,status,uploaded_at").single();
        if (updateError) throw new ApiError(400, updateError.message);
        const { error: auditError } = await supabaseAdmin.from("payment_control_audit").insert({
          payment_notification_id: input.payment_notification_id,
          actor_employee_id: actor.employee.id,
          reason: input.reason,
          before_record: before,
          after_record: after,
        });
        if (auditError) {
          // Keep the correction reversible if its audit event could not be saved.
          await supabaseAdmin.from("payment_notifications").update({ amount: before.amount, sender_phone: before.sender_phone, text_content: before.text_content }).eq("id", before.id);
          throw new ApiError(500, `Correction rolled back because the audit entry failed: ${auditError.message}`);
        }
        return Response.json({ ok: true, payment: after }, { headers: { "cache-control": "no-store" } });
      } catch (error) { return responseError(error); }
    },
  } },
});

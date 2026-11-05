import { createFileRoute } from "@tanstack/react-router";
import { verifyStaffJwt } from "@/lib/storage-sign.server";

// Links one uploaded payment evidence record to one or many cargo packages.
// The service-role write is deliberately confined to the locked database RPC so
// duplicate, overpayment, and concurrent multi-package requests are atomic.
type AllocationInput = {
  package_id?: unknown;
  order_id?: unknown;
  tracking_number?: unknown;
  amount?: unknown;
};

type LinkPaymentBody = {
  payment_notification_id?: unknown;
  allocations?: unknown;
};

function rpcResult(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export const Route = createFileRoute("/api/public/link-payment")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await verifyStaffJwt(request);
        if (!user) return new Response("Unauthorized", { status: 401 });

        let body: LinkPaymentBody;
        try {
          body = (await request.json()) as LinkPaymentBody;
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const notificationId = String(body.payment_notification_id ?? "").trim();
        if (!notificationId) {
          return Response.json({ error: "payment_notification_id is required" }, { status: 400 });
        }
        if (!Array.isArray(body.allocations) || body.allocations.length === 0) {
          return Response.json({ error: "At least one allocation is required" }, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: employee, error: employeeError } = await supabaseAdmin
          .from("employees")
          .select("id,is_active")
          .eq("user_id", user.id)
          .maybeSingle();
        if (employeeError) return Response.json({ error: employeeError.message }, { status: 500 });
        if (!employee?.is_active) {
          return Response.json(
            { error: "An active employee account is required" },
            { status: 403 },
          );
        }

        const allocations: { package_id: string; amount: number }[] = [];
        for (const raw of body.allocations) {
          if (!raw || typeof raw !== "object") {
            return Response.json({ error: "Every allocation must be an object" }, { status: 400 });
          }
          const input = raw as AllocationInput;
          const packageId = String(
            input.package_id ?? input.order_id ?? input.tracking_number ?? "",
          ).trim();
          if (!packageId) {
            return Response.json({ error: "Every allocation needs a package_id" }, { status: 400 });
          }
          if (
            input.amount === undefined ||
            input.amount === null ||
            String(input.amount).trim() === ""
          ) {
            return Response.json(
              { error: `An explicit amount is required for package ${packageId}` },
              { status: 400 },
            );
          }
          const amount = Number(input.amount);
          if (!Number.isFinite(amount) || amount <= 0) {
            return Response.json(
              { error: `Invalid amount for package ${packageId}` },
              { status: 400 },
            );
          }
          allocations.push({ package_id: packageId, amount });
        }

        // user.email/user.id is audit metadata only; authorization is based on
        // the active employees row above, never on a client-supplied linked_by.
        const { data, error } = await supabaseAdmin.rpc("link_payment_allocations", {
          _payment_notification_id: notificationId,
          _allocations: allocations,
          _linked_by: user.email ?? user.id,
        });
        if (error) {
          const message = error.message || "Unable to link payment evidence";
          const conflict = /already|exceed|released|fully paid|remaining balance/i.test(message);
          return Response.json({ error: message }, { status: conflict ? 409 : 400 });
        }

        return Response.json(
          { ok: true, ...rpcResult(data) },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});

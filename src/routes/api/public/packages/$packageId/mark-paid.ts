import { createFileRoute } from "@tanstack/react-router";
import { verifyStaffJwt } from "@/lib/storage-sign.server";

// Records an in-person payment where there is no uploaded evidence to link.
// This is deliberately a backend operation: a desktop or mobile client must
// never patch cargo_packages directly and claim that money was collected.
export const Route = createFileRoute("/api/public/packages/$packageId/mark-paid")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const user = await verifyStaffJwt(request);
        if (!user) return new Response("Unauthorized", { status: 401 });

        let body: { payment_method?: string; payment_reference?: string; note?: string; commission_employee_id?: string };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: employee } = await supabaseAdmin
          .from("employees")
          .select("role,is_active")
          .eq("user_id", user.id)
          .maybeSingle();
        const role = String(employee?.role ?? "").toLowerCase();
        if (!employee?.is_active || !["admin", "logistics_manager", "sales_manager"].includes(role)) {
          return Response.json({ error: "Your account does not have permission to release packages." }, { status: 403 });
        }

        const packageId = String(params.packageId ?? "").trim();
        if (!packageId) return Response.json({ error: "Package ID is required" }, { status: 400 });
        const paymentMethod = String(body.payment_method ?? "").trim();
        if (!paymentMethod) return Response.json({ error: "Choose a payment method" }, { status: 400 });

        const { data: pkg, error: packageError } = await supabaseAdmin
          .from("cargo_packages")
          .select("id,tracking_number,status,cost,paid_at,payment_ref,payment_method")
          .eq("id", packageId)
          .maybeSingle();
        if (packageError) return Response.json({ error: packageError.message }, { status: 500 });
        if (!pkg) return Response.json({ error: "Package was not found" }, { status: 404 });

        const commissionEmployeeId = String(body.commission_employee_id ?? "").trim();
        if (commissionEmployeeId) {
          const { data: commissionEmployee, error: commissionEmployeeError } = await supabaseAdmin
            .from("employees")
            .select("id,role,is_active")
            .eq("id", commissionEmployeeId)
            .maybeSingle();
          if (commissionEmployeeError) return Response.json({ error: commissionEmployeeError.message }, { status: 500 });
          if (!commissionEmployee?.is_active || ["admin", "finance_manager"].includes(String(commissionEmployee.role).toLowerCase())) {
            return Response.json({ error: "Choose an active commission-eligible employee." }, { status: 400 });
          }
          // Set the owner before the allocation is inserted: the SQL payment
          // trigger then creates the commission against the selected employee.
          const { error: assignmentError } = await supabaseAdmin
            .from("cargo_packages")
            .update({ commission_employee_id: commissionEmployee.id })
            .eq("id", pkg.id);
          if (assignmentError) return Response.json({ error: assignmentError.message }, { status: 400 });
        }

        const alreadyPaid = ["paid", "cleared", "released", "collected"].includes(String(pkg.status ?? "").toLowerCase());
        if (alreadyPaid) {
          return Response.json({ ok: true, already_paid: true, package: pkg }, { headers: { "cache-control": "no-store" } });
        }

        const reference = String(body.payment_reference ?? "").trim() || `MANUAL-${Date.now()}`;
        const now = new Date().toISOString();

        // A manual collection still enters the same payment-allocation path as
        // a screenshot/text evidence record.  The allocation trigger is where
        // eligible employee commission is awarded, so bypassing it would make
        // cash collections disappear from commission and reconciliation data.
        const paymentId = `PN-${Date.now()}`;
        const notificationNumber = reference;
        const { error: paymentError } = await supabaseAdmin.from("payment_notifications").insert({
          id: paymentId,
          notification_number: notificationNumber,
          evidence_type: "TEXT",
          text_content: note || `Manual ${paymentMethod} collection recorded at release.`,
          uploaded_by: user.email ?? user.id,
          uploaded_at: now,
          status: "LINKED",
          amount: Number(pkg.cost ?? 0),
          timestamp: now,
        });
        if (paymentError) return Response.json({ error: paymentError.message }, { status: 400 });
        const { error: allocationError } = await supabaseAdmin.from("payment_allocations").insert({
          id: `PA-${Date.now()}`,
          payment_notification_id: paymentId,
          order_id: pkg.id,
          tracking_number: pkg.id,
          allocated_amount: Number(pkg.cost ?? 0),
          notification_number: notificationNumber,
          linked_by: user.email ?? user.id,
          linked_at: now,
        });
        if (allocationError) return Response.json({ error: allocationError.message }, { status: 400 });
        const { data: updated, error: updateError } = await supabaseAdmin
          .from("cargo_packages")
          .update({
            status: "paid",
            paid_at: now,
            payment_method: paymentMethod,
            payment_ref: reference,
          })
          .eq("id", pkg.id)
          .select("id,tracking_number,status,cost,paid_at,payment_ref,payment_method")
          .single();
        if (updateError) return Response.json({ error: updateError.message }, { status: 400 });

        // Record the collection note without making it part of the status
        // machine. audit_logs differs in older deployments, so an audit write
        // must not cause a successful payment to be reported as failed.
        const note = String(body.note ?? "").trim();
        if (note) {
          await supabaseAdmin.from("audit_logs").insert({
            id: `AL-${Date.now()}`,
            action: "MARK_PACKAGE_PAID",
            actor: user.email ?? user.id,
            timestamp: now,
            details: `Package ${pkg.id} marked paid (${paymentMethod}; ${reference}): ${note}`,
          });
        }

        return Response.json({ ok: true, payment_notification_id: paymentId, package: updated }, { headers: { "cache-control": "no-store" } });
      },
    },
  },
});

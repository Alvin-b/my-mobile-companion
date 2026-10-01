import { createFileRoute } from "@tanstack/react-router";
import { verifyStaffJwt } from "@/lib/storage-sign.server";

// Operational metadata for a cargo package.  This endpoint deliberately owns
// commission assignment and international forwarding, so desktop/mobile apps
// cannot bypass role checks by patching cargo_packages directly.
export const Route = createFileRoute("/api/public/packages/$packageId/operations")({
  server: {
    handlers: {
      PUT: async ({ request, params }) => {
        const user = await verifyStaffJwt(request);
        if (!user) return new Response("Unauthorized", { status: 401 });

        let body: { commission_employee_id?: unknown; is_international_forwarding?: unknown; forward_destination_country?: unknown };
        try { body = await request.json(); }
        catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: actor } = await supabaseAdmin
          .from("employees")
          .select("role,is_active")
          .eq("user_id", user.id)
          .maybeSingle();
        if (!actor?.is_active || !["admin", "logistics_manager", "sales_manager", "sales_rep"].includes(String(actor.role).toLowerCase())) {
          return Response.json({ error: "Your account does not have permission to update package operations." }, { status: 403 });
        }

        const packageId = String(params.packageId ?? "").trim();
        const { data: pkg, error: packageError } = await supabaseAdmin
          .from("cargo_packages")
          .select("id,status,commission_employee_id")
          .eq("id", packageId)
          .maybeSingle();
        if (packageError) return Response.json({ error: packageError.message }, { status: 500 });
        if (!pkg) return Response.json({ error: "Package was not found" }, { status: 404 });

        const patch: Record<string, unknown> = {};
        if (Object.prototype.hasOwnProperty.call(body, "commission_employee_id")) {
          const employeeId = String(body.commission_employee_id ?? "").trim();
          if (employeeId) {
            const { data: target, error: targetError } = await supabaseAdmin
              .from("employees")
              .select("id,role,is_active")
              .eq("id", employeeId)
              .maybeSingle();
            if (targetError) return Response.json({ error: targetError.message }, { status: 500 });
            if (!target?.is_active || ["admin", "finance_manager"].includes(String(target.role).toLowerCase())) {
              return Response.json({ error: "Choose an active employee eligible for commission." }, { status: 400 });
            }
            patch.commission_employee_id = target.id;
          } else {
            patch.commission_employee_id = null;
          }
        }

        if (Object.prototype.hasOwnProperty.call(body, "is_international_forwarding")) {
          const forwarding = body.is_international_forwarding === true || body.is_international_forwarding === "true";
          const country = String(body.forward_destination_country ?? "").trim();
          if (forwarding && !country) return Response.json({ error: "Enter the destination country for international forwarding." }, { status: 400 });
          if (country.length > 80) return Response.json({ error: "Destination country must be 80 characters or fewer." }, { status: 400 });
          patch.is_international_forwarding = forwarding;
          patch.forward_destination_country = forwarding ? country : null;
        }

        if (!Object.keys(patch).length) return Response.json({ error: "No package operation was supplied" }, { status: 400 });
        const { data, error } = await supabaseAdmin
          .from("cargo_packages")
          .update(patch)
          .eq("id", pkg.id)
          .select("id,tracking_number,commission_employee_id,is_international_forwarding,forward_destination_country")
          .maybeSingle();
        if (error) return Response.json({ error: error.message }, { status: 400 });
        return Response.json({ ok: true, package: data }, { headers: { "cache-control": "no-store" } });
      },
    },
  },
});

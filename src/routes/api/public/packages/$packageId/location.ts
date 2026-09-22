import { createFileRoute } from "@tanstack/react-router";
import { verifyStaffJwt } from "@/lib/storage-sign.server";

// A warehouse location is operational metadata, deliberately separate from
// imported container_position. Only managers can change it.
export const Route = createFileRoute("/api/public/packages/$packageId/location")({
  server: {
    handlers: {
      PUT: async ({ request, params }) => {
        const user = await verifyStaffJwt(request);
        if (!user) return new Response("Unauthorized", { status: 401 });

        let body: { location?: unknown };
        try { body = await request.json(); }
        catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }

        const location = String(body.location ?? "").trim();
        if (location.length > 100) return Response.json({ error: "Location must be 100 characters or fewer" }, { status: 400 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: employee } = await supabaseAdmin
          .from("employees")
          .select("role,is_active")
          .eq("user_id", user.id)
          .maybeSingle();
        if (!employee?.is_active || !["admin", "logistics_manager", "sales_manager"].includes(String(employee.role).toLowerCase())) {
          return Response.json({ error: "Your account does not have permission to set package locations." }, { status: 403 });
        }

        const { data, error } = await supabaseAdmin
          .from("cargo_packages")
          .update({ location: location || null })
          .eq("id", params.packageId)
          .select("id,tracking_number,location")
          .maybeSingle();
        if (error) return Response.json({ error: error.message }, { status: 400 });
        if (!data) return Response.json({ error: "Package was not found" }, { status: 404 });
        return Response.json({ ok: true, package: data }, { headers: { "cache-control": "no-store" } });
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { verifyStaffJwt } from "@/lib/storage-sign.server";

function rpcResult(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export const Route = createFileRoute("/api/public/packages/$packageId/release")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const user = await verifyStaffJwt(request);
        if (!user) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: actor, error: actorError } = await supabaseAdmin
          .from("employees")
          .select("id,role,is_active")
          .eq("user_id", user.id)
          .maybeSingle();
        if (actorError) return Response.json({ error: actorError.message }, { status: 500 });
        if (
          !actor?.is_active ||
          !["admin", "logistics_manager", "sales_manager"].includes(
            String(actor.role).toLowerCase(),
          )
        ) {
          return Response.json(
            { error: "Your account does not have permission to release packages." },
            { status: 403 },
          );
        }

        const packageId = String(params.packageId ?? "").trim();
        if (!packageId) return Response.json({ error: "Package ID is required" }, { status: 400 });

        const { data, error } = await supabaseAdmin.rpc("release_cargo_package", {
          _package_id: packageId,
          _actor_employee_id: actor.id,
          _actor: user.email ?? user.id,
        });
        if (error) {
          const message = error.message || "Unable to release package";
          const notFound = /not found/i.test(message);
          const unpaid = /only paid|permission/i.test(message);
          return Response.json({ error: message }, { status: notFound ? 404 : unpaid ? 409 : 400 });
        }

        return Response.json(
          { ok: true, package: rpcResult(data) },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});

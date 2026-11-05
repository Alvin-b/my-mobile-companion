import { createFileRoute } from "@tanstack/react-router";
import { verifyStaffJwt } from "@/lib/storage-sign.server";

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
        const { data: pkg, error: packageError } = await supabaseAdmin
          .from("cargo_packages")
          .select("id,tracking_number,status,paid_at,collected_at")
          .eq("id", packageId)
          .maybeSingle();
        if (packageError) return Response.json({ error: packageError.message }, { status: 500 });
        if (!pkg) return Response.json({ error: "Package was not found" }, { status: 404 });
        if (
          !pkg.paid_at &&
          !["paid", "cleared", "collected", "released"].includes(
            String(pkg.status ?? "").toLowerCase(),
          )
        ) {
          return Response.json({ error: "Only paid packages can be released." }, { status: 409 });
        }
        if (["collected", "released"].includes(String(pkg.status ?? "").toLowerCase())) {
          return Response.json({ ok: true, already_released: true, package: pkg });
        }
        const now = new Date().toISOString();
        const { data: updated, error: updateError } = await supabaseAdmin
          .from("cargo_packages")
          .update({ status: "released", collected_at: now })
          .eq("id", pkg.id)
          .select("id,tracking_number,status,paid_at,collected_at")
          .single();
        if (updateError) return Response.json({ error: updateError.message }, { status: 400 });
        await supabaseAdmin.from("audit_logs").insert({
          id: `AL-${Date.now()}`,
          action: "RELEASE_PACKAGE",
          actor: user.email ?? user.id,
          timestamp: now,
          details: `Package ${pkg.tracking_number ?? pkg.id} released from the desktop console.`,
        });
        return Response.json(
          { ok: true, package: updated },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { FinanceApiError, financeErrorResponse, requireFinanceAccess } from "@/lib/finance-api.server";

const MODES = ["not_configured", "sandbox", "production"];
const STATUSES = ["not_connected", "ready_for_sandbox", "certification_pending", "connected"];
const trim = (value: unknown) => String(value ?? "").trim();

/** Finance Manager (and admin) control panel for KRA eTIMS compliance settings. */
export const Route = createFileRoute("/api/public/finance/etims-settings")({
  server: { handlers: {
    GET: async ({ request }) => {
      try {
        const { supabaseAdmin, role } = await requireFinanceAccess(request);
        const { data, error } = await supabaseAdmin
          .from("finance_settings")
          .select("id,legal_name,kra_pin,vat_registered,branch_name,invoice_prefix,etims_mode,etims_status,etims_provider,etims_business_id,etims_last_checked_at,updated_at")
          .eq("id", true)
          .maybeSingle();
        if (error) throw new FinanceApiError(500, error.message);
        return Response.json({
          settings: data,
          role,
          // Credentials themselves are never returned — only whether they are present.
          provider_credentials_configured: Boolean(process.env["DEITAX_API_URL"] && process.env["DEITAX_API_KEY"]),
        }, { headers: { "cache-control": "no-store" } });
      } catch (error) { return financeErrorResponse(error); }
    },
    PUT: async ({ request }) => {
      try {
        const { user, supabaseAdmin } = await requireFinanceAccess(request);
        const body = await request.json() as Record<string, unknown>;

        const mode = trim(body.etims_mode) || "not_configured";
        const provider = trim(body.etims_provider) || "deitax";
        if (!MODES.includes(mode)) throw new FinanceApiError(400, "eTIMS mode must be not_configured, sandbox or production.");
        if (!["deitax", "none"].includes(provider)) throw new FinanceApiError(400, "eTIMS provider must be deitax or none.");

        const kraPin = trim(body.kra_pin).toUpperCase();
        if (kraPin && !/^[A-Z]\d{9}[A-Z]$/.test(kraPin)) throw new FinanceApiError(400, "KRA PIN must look like P051234567X.");

        const legalName = trim(body.legal_name);
        const branch = trim(body.branch_name);
        const credentialsReady = Boolean(process.env["DEITAX_API_URL"] && process.env["DEITAX_API_KEY"]);
        const profileComplete = Boolean(legalName && kraPin && branch);

        // The status is derived — a finance manager cannot mark themselves "connected".
        let status: string = "not_connected";
        if (provider === "none") status = "not_connected";
        else if (profileComplete && credentialsReady && mode === "production") status = "connected";
        else if (profileComplete && credentialsReady && mode === "sandbox") status = "connected";
        else if (profileComplete && mode !== "not_configured") status = "certification_pending";
        else if (profileComplete) status = "ready_for_sandbox";
        if (!STATUSES.includes(status)) status = "not_connected";

        const patch = {
          id: true as const,
          legal_name: legalName || null,
          kra_pin: kraPin || null,
          vat_registered: Boolean(body.vat_registered),
          branch_name: branch || null,
          invoice_prefix: (trim(body.invoice_prefix) || "DEX").replace(/[^A-Za-z0-9-]/g, "").slice(0, 16) || "DEX",
          etims_mode: mode,
          etims_provider: provider,
          etims_business_id: trim(body.etims_business_id) || null,
          etims_status: status,
          etims_last_checked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          updated_by: user.id,
        };

        const { data, error } = await supabaseAdmin.from("finance_settings").upsert(patch, { onConflict: "id" }).select().single();
        if (error) throw new FinanceApiError(400, error.message);
        return Response.json({ settings: data, provider_credentials_configured: credentialsReady });
      } catch (error) { return financeErrorResponse(error); }
    },
  } },
});

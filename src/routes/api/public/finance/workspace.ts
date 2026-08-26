import { createFileRoute } from "@tanstack/react-router";
import { financeErrorResponse, requireFinanceAccess } from "@/lib/finance-api.server";

// Single live-read endpoint for the desktop workspace. Sensitive provider
// credentials remain server environment variables and are never returned.
export const Route = createFileRoute("/api/public/finance/workspace")({
  server: { handlers: { GET: async ({ request }) => {
    try {
      const { supabaseAdmin } = await requireFinanceAccess(request);
      const [settings, invoices, expenses, closes, approvals, packages, notifications] = await Promise.all([
        supabaseAdmin.from("finance_settings").select("id,legal_name,kra_pin,vat_registered,branch_name,invoice_prefix,etims_mode,etims_status,etims_provider,etims_business_id,etims_last_checked_at,updated_at").eq("id", true).maybeSingle(),
        supabaseAdmin.from("finance_invoices").select("*").order("created_at", { ascending: false }).limit(150),
        supabaseAdmin.from("finance_expenses").select("*").order("expense_date", { ascending: false }).limit(150),
        supabaseAdmin.from("finance_month_closes").select("*").order("period", { ascending: false }).limit(24),
        supabaseAdmin.from("finance_approvals").select("*").order("created_at", { ascending: false }).limit(150),
        supabaseAdmin.from("cargo_packages").select("id,tracking_number,consignee,phone,cost,status,paid_at,cleared_at,registered_at,mode,origin,dest").order("registered_at", { ascending: false }).limit(500),
        supabaseAdmin.from("payment_notifications").select("id,notification_number,evidence_type,text_content,image_url,amount,status,uploaded_at").order("uploaded_at", { ascending: false }).limit(200),
      ]);
      for (const result of [settings, invoices, expenses, closes, approvals, packages, notifications]) {
        if (result.error) return Response.json({ error: result.error.message }, { status: 500 });
      }
      return Response.json({
        settings: settings.data, invoices: invoices.data ?? [], expenses: expenses.data ?? [], closes: closes.data ?? [], approvals: approvals.data ?? [], packages: packages.data ?? [], payment_notifications: notifications.data ?? [],
      }, { headers: { "cache-control": "no-store" } });
    } catch (error) { return financeErrorResponse(error); }
  } } },
});

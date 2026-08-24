import { createFileRoute } from "@tanstack/react-router";
import { verifyStaffJwt } from "@/lib/storage-sign.server";

type InvoiceItem = { description: string; quantity: number | null; unit_price: number | null; line_total: number | null };
const asNumber = (value: unknown) => Number(value ?? 0);

function readProviderResponse(body: any) {
  const data = body?.data ?? body?.result ?? body;
  return {
    submissionId: data?.submission_id ?? data?.submissionId ?? data?.id ?? data?.request_id ?? null,
    invoiceNumber: data?.invoice_number ?? data?.invoiceNumber ?? data?.etims_invoice_number ?? data?.invoice_no ?? null,
    controlCode: data?.control_code ?? data?.controlCode ?? data?.etims_control_code ?? data?.receipt_number ?? null,
    accepted: data?.accepted === true || data?.status === "accepted" || data?.status === "success" || data?.success === true,
    message: data?.message ?? data?.error?.message ?? null,
  };
}

export const Route = createFileRoute("/api/public/finance/submit-etims")({
  server: { handlers: { POST: async ({ request }) => {
    const user = await verifyStaffJwt(request);
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    let body: { invoice_id?: string };
    try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
    const invoiceId = String(body.invoice_id ?? "").trim();
    if (!invoiceId) return Response.json({ error: "invoice_id is required" }, { status: 400 });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: employee } = await supabaseAdmin.from("employees").select("role,is_active").eq("user_id", user.id).maybeSingle();
    if (!employee?.is_active || !["admin", "finance_manager"].includes(employee.role)) return Response.json({ error: "Finance Manager or administrator access is required" }, { status: 403 });

    const [{ data: settings, error: settingsError }, { data: invoice, error: invoiceError }, { data: items, error: itemsError }] = await Promise.all([
      supabaseAdmin.from("finance_settings").select("legal_name,kra_pin,vat_registered,branch_name,etims_mode,etims_status,etims_provider,etims_business_id").eq("id", true).maybeSingle(),
      supabaseAdmin.from("finance_invoices").select("*").eq("id", invoiceId).maybeSingle(),
      supabaseAdmin.from("finance_invoice_items").select("description,quantity,unit_price,line_total").eq("invoice_id", invoiceId),
    ]);
    if (settingsError || invoiceError || itemsError) return Response.json({ error: settingsError?.message ?? invoiceError?.message ?? itemsError?.message }, { status: 500 });
    if (!invoice) return Response.json({ error: "Invoice not found" }, { status: 404 });
    if (!settings?.legal_name || !settings?.kra_pin || !settings?.branch_name) return Response.json({ error: "Complete the DEX legal name, KRA PIN and branch name in finance settings before submitting." }, { status: 400 });
    if (settings.etims_provider !== "deitax") return Response.json({ error: "Deitax is not selected as the eTIMS provider." }, { status: 400 });
    if (!['sandbox', 'production'].includes(settings.etims_mode) || settings.etims_status !== "connected") return Response.json({ error: "Deitax eTIMS is not connected. Complete sandbox/production setup first." }, { status: 409 });
    if (["accepted", "cancelled", "credited"].includes(invoice.status)) return Response.json({ error: `Invoice is already ${invoice.status} and cannot be submitted again.` }, { status: 409 });
    if (!items?.length) return Response.json({ error: "An eTIMS invoice needs at least one package or service line." }, { status: 400 });

    const apiUrl = process.env.DEITAX_API_URL;
    const apiKey = process.env.DEITAX_API_KEY;
    const apiKeyHeader = process.env.DEITAX_API_KEY_HEADER || "X-API-Key";
    if (!apiUrl || !apiKey) return Response.json({ error: "Deitax is not configured on the server. Add DEITAX_API_URL and DEITAX_API_KEY as deployment secrets." }, { status: 503 });

    // DEX's document shape follows the KRA TIS flow: a NORMAL SALE receipt
    // includes seller, buyer, line items, tax totals and payment means. Deities
    // can translate this envelope to its provider-specific endpoint.
    const payload = {
      invoice_number: invoice.invoice_number,
      invoice_date: invoice.issue_date,
      currency: "KES",
      receipt_type: invoice.etims_receipt_type ?? "NORMAL",
      transaction_type: invoice.etims_transaction_type ?? "SALE",
      receipt_label: `${invoice.etims_receipt_type === "NORMAL" ? "N" : invoice.etims_receipt_type === "COPY" ? "C" : invoice.etims_receipt_type === "TRAINING" ? "T" : "P"}${invoice.etims_transaction_type === "SALE" ? "S" : invoice.etims_transaction_type === "CREDIT_NOTE" ? "C" : "D"}`,
      seller: { legal_name: settings.legal_name, kra_pin: settings.kra_pin, branch_name: settings.branch_name, business_id: settings.etims_business_id ?? undefined },
      buyer: { name: invoice.customer_name, kra_pin: invoice.customer_pin ?? undefined, phone: invoice.customer_phone ?? undefined },
      tax: { vat_registered: settings.vat_registered, rate: asNumber(invoice.tax_rate), amount: asNumber(invoice.tax_amount) },
      totals: { subtotal: asNumber(invoice.subtotal), tax: asNumber(invoice.tax_amount), total: asNumber(invoice.total) },
      payment_method: invoice.payment_method ?? "other",
      items: (items ?? []).map((item: InvoiceItem) => ({ description: item.description, quantity: asNumber(item.quantity) || 1, unit_price: asNumber(item.unit_price), total: asNumber(item.line_total) })),
      reference: { dex_invoice_id: invoice.id, package_ids: invoice.package_ids ?? [] },
    };

    let providerBody: any = null;
    let status = 0;
    try {
      const response = await fetch(apiUrl, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", [apiKeyHeader]: apiKey }, body: JSON.stringify(payload) });
      status = response.status;
      providerBody = await response.json().catch(async () => ({ raw: (await response.text()).slice(0, 2000) }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to reach Deitax";
      await supabaseAdmin.from("finance_invoices").update({ status: invoice.status === "submitted" ? "submitted" : "draft", rejection_reason: message, etims_provider: "deitax", etims_attempt_count: Number(invoice.etims_attempt_count ?? 0) + 1, etims_last_attempt_at: new Date().toISOString(), etims_response: { connection_error: message } }).eq("id", invoice.id);
      return Response.json({ error: `Deitax connection failed: ${message}` }, { status: 502 });
    }
    const result = readProviderResponse(providerBody);
    const accepted = status >= 200 && status < 300 && result.accepted;
    const nextStatus = accepted ? "accepted" : status >= 200 && status < 300 ? "submitted" : "rejected";
    const update = {
      status: nextStatus, etims_provider: "deitax", etims_submission_id: result.submissionId,
      etims_invoice_number: result.invoiceNumber, etims_control_code: result.controlCode,
      etims_response: { http_status: status, response: providerBody }, etims_attempt_count: Number(invoice.etims_attempt_count ?? 0) + 1,
      etims_last_attempt_at: new Date().toISOString(), submitted_at: new Date().toISOString(), accepted_at: accepted ? new Date().toISOString() : null,
      rejection_reason: accepted ? null : result.message ?? `Deitax returned HTTP ${status}`,
    };
    const { error: updateError } = await supabaseAdmin.from("finance_invoices").update(update).eq("id", invoice.id);
    if (updateError) return Response.json({ error: updateError.message }, { status: 500 });
    return Response.json({ ok: accepted, status: nextStatus, invoice_number: result.invoiceNumber, control_code: result.controlCode, submission_id: result.submissionId, message: result.message }, { status: accepted ? 200 : 502 });
  } } },
});

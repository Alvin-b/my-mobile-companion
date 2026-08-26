import { createFileRoute } from "@tanstack/react-router";
import { FinanceApiError, financeErrorResponse, requireFinanceAccess } from "@/lib/finance-api.server";

type Line = { description?: string; quantity?: number; unit_price?: number; package_id?: string | null };
const number = (value: unknown) => Number(value ?? 0);

export const Route = createFileRoute("/api/public/finance/invoices")({
  server: { handlers: {
    POST: async ({ request }) => {
      try {
        const { user, supabaseAdmin } = await requireFinanceAccess(request);
        const body = await request.json() as { customer_name?: string; customer_pin?: string; customer_phone?: string; due_date?: string; notes?: string; payment_method?: string; tax_rate?: number; items?: Line[] };
        const customer = String(body.customer_name ?? "").trim();
        const lines = (body.items ?? []).filter((line) => String(line.description ?? "").trim());
        if (!customer) throw new FinanceApiError(400, "Customer name is required.");
        if (!lines.length) throw new FinanceApiError(400, "Add at least one invoice line.");
        const prepared = lines.map((line) => {
          const quantity = number(line.quantity) || 1;
          const unitPrice = number(line.unit_price);
          if (quantity <= 0 || unitPrice < 0) throw new FinanceApiError(400, "Invoice quantities and prices must be valid.");
          return { description: String(line.description).trim(), quantity, unit_price: unitPrice, line_total: quantity * unitPrice, package_id: line.package_id || null };
        });
        const subtotal = prepared.reduce((sum, line) => sum + line.line_total, 0);
        const taxRate = Math.max(0, number(body.tax_rate));
        const taxAmount = subtotal * taxRate / 100;
        const { data: settings, error: settingsError } = await supabaseAdmin.from("finance_settings").select("invoice_prefix").eq("id", true).maybeSingle();
        if (settingsError) throw new FinanceApiError(500, settingsError.message);
        const prefix = String(settings?.invoice_prefix || "DEX").replace(/[^A-Za-z0-9-]/g, "").slice(0, 16) || "DEX";
        const invoiceNumber = `${prefix}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${String(Date.now()).slice(-6)}`;
        const { data: invoice, error } = await supabaseAdmin.from("finance_invoices").insert({
          invoice_number: invoiceNumber, customer_name: customer, customer_pin: body.customer_pin?.trim() || null, customer_phone: body.customer_phone?.trim() || null,
          due_date: body.due_date || null, notes: body.notes?.trim() || null, payment_method: body.payment_method || "mpesa", subtotal, tax_rate: taxRate, tax_amount: taxAmount, total: subtotal + taxAmount,
          package_ids: prepared.map((line) => line.package_id).filter(Boolean), status: "draft", etims_receipt_type: "NORMAL", etims_transaction_type: "SALE", created_by: user.id,
        }).select().single();
        if (error || !invoice) throw new FinanceApiError(400, error?.message ?? "Could not create invoice.");
        const { error: itemsError } = await supabaseAdmin.from("finance_invoice_items").insert(prepared.map((line) => ({ ...line, invoice_id: invoice.id })));
        if (itemsError) { await supabaseAdmin.from("finance_invoices").delete().eq("id", invoice.id); throw new FinanceApiError(400, itemsError.message); }
        return Response.json({ invoice }, { status: 201 });
      } catch (error) { return financeErrorResponse(error); }
    },
    PATCH: async ({ request }) => {
      try {
        const { user, supabaseAdmin } = await requireFinanceAccess(request);
        const body = await request.json() as { invoice_id?: string; action?: string };
        const id = String(body.invoice_id ?? "").trim();
        const action = String(body.action ?? "").trim();
        if (!id || !["approve", "cancel", "credit"].includes(action)) throw new FinanceApiError(400, "A valid invoice action is required.");
        const patch = action === "approve" ? { status: "approved", approved_by: user.id, approved_at: new Date().toISOString() } : action === "cancel" ? { status: "cancelled" } : { status: "credited" };
        const { data, error } = await supabaseAdmin.from("finance_invoices").update(patch).eq("id", id).select().single();
        if (error) throw new FinanceApiError(400, error.message);
        return Response.json({ invoice: data });
      } catch (error) { return financeErrorResponse(error); }
    },
  } },
});

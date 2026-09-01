import { createFileRoute } from "@tanstack/react-router";
import { FinanceApiError, financeErrorResponse, requireFinanceAccess } from "@/lib/finance-api.server";

export const Route = createFileRoute("/api/public/finance/expenses")({
  server: { handlers: {
    POST: async ({ request }) => {
      try {
        const { user, supabaseAdmin } = await requireFinanceAccess(request);
        const body = await request.json() as Record<string, unknown>;
        const supplier = String(body.supplier_name ?? "").trim(), category = String(body.category ?? "").trim(), amount = Number(body.amount ?? 0);
        if (!supplier || !category || !Number.isFinite(amount) || amount < 0) throw new FinanceApiError(400, "Supplier, category and a valid amount are required.");
        const { data, error } = await supabaseAdmin.from("finance_expenses").insert({ supplier_name: supplier, category, amount, expense_date: String(body.expense_date ?? "").trim() || new Date().toISOString().slice(0, 10), description: String(body.description ?? "").trim() || null, payment_method: String(body.payment_method ?? "").trim() || null, receipt_url: String(body.receipt_url ?? "").trim() || null, package_id: String(body.package_id ?? "").trim() || null, submitted_by: user.id, status: "submitted" }).select().single();
        if (error) throw new FinanceApiError(400, error.message);
        return Response.json({ expense: data }, { status: 201 });
      } catch (error) { return financeErrorResponse(error); }
    },
    PATCH: async ({ request }) => {
      try {
        const { user, supabaseAdmin } = await requireFinanceAccess(request);
        const body = await request.json() as { expense_id?: string; action?: string };
        const id = String(body.expense_id ?? "").trim(), action = String(body.action ?? "").trim();
        if (!id || !["approve", "paid", "reject", "void"].includes(action)) throw new FinanceApiError(400, "A valid expense action is required.");
        const patch: { status: string; approved_by?: string; approved_at?: string } = { status: action === "reject" ? "rejected" : action };
        if (action === "approve") { patch.approved_by = user.id; patch.approved_at = new Date().toISOString(); }
        const { data, error } = await supabaseAdmin.from("finance_expenses").update(patch).eq("id", id).select().single();
        if (error) throw new FinanceApiError(400, error.message);
        return Response.json({ expense: data });
      } catch (error) { return financeErrorResponse(error); }
    },
  } },
});

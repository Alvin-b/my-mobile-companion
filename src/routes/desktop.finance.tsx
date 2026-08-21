import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Kpi, PageHead, Panel } from "@/components/desktop/DesktopShell";
import { dayKey, lastNDays, shortDay, useCargo, useCommissions, usePayments } from "@/hooks/use-admin-metrics";
import { supabase } from "@/integrations/supabase/client";
import { fmtKES, fmtRelative } from "@/lib/format";
import { useEmployee } from "@/hooks/use-employee";
import { useState, type ReactNode } from "react";

export const Route = createFileRoute("/desktop/finance")({
  head: () => ({
    meta: [
      { title: "Finance — DEXCARGO Admin Console" },
      { name: "description", content: "Commission ledger, payment method mix and daily settlement analytics for DEXCARGO finance administrators." },
      { property: "og:title", content: "DEXCARGO Finance Analytics" },
      { property: "og:description", content: "Commission ledger, payment mix and settlement trends." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Finance,
});

const COMMISSION_TINT: Record<string, string> = { pending: "#F59E0B", approved: "#3B6BF5", paid: "#10B981" };
const METHOD_TINT = ["#10B981", "#3B6BF5", "#F59E0B", "#14B8A6"];
const axis = { stroke: "#64748B", fontSize: 10 };
const tooltipStyle = { background: "#111827", border: "1px solid #1F2937", borderRadius: 10, fontSize: 11, color: "#E2E8F0" };

function Finance() {
  const { employee } = useEmployee();
  const cargo = useCargo();
  const commissions = useCommissions();
  const payments = usePayments();
  const qc = useQueryClient();

  const comms = commissions.data ?? [];
  const pays = payments.data ?? [];
  const rows = cargo.data ?? [];
  const finance = useQuery({
    queryKey: ["finance-workspace"],
    queryFn: async () => {
      const db = supabase as any;
      const [invoices, expenses, closes, settings] = await Promise.all([
        db.from("finance_invoices").select("*").order("created_at", { ascending: false }).limit(80),
        db.from("finance_expenses").select("*").order("expense_date", { ascending: false }).limit(80),
        db.from("finance_month_closes").select("*").order("period", { ascending: false }).limit(12),
        db.from("finance_settings").select("*").eq("id", true).maybeSingle(),
      ]);
      for (const result of [invoices, expenses, closes, settings]) if (result.error) throw result.error;
      return { invoices: invoices.data ?? [], expenses: expenses.data ?? [], closes: closes.data ?? [], settings: settings.data };
    },
  });
  const invoices = finance.data?.invoices ?? [];
  const expenses = finance.data?.expenses ?? [];
  const outstandingInvoices = invoices.filter((x: any) => !["accepted", "cancelled", "credited"].includes(x.status));
  const expenseTotal = expenses.filter((x: any) => !["rejected", "void"].includes(x.status)).reduce((sum: number, x: any) => sum + Number(x.amount ?? 0), 0);
  const financeRevenue = rows.filter((r) => Boolean(r.paid_at)).reduce((sum, r) => sum + Number(r.cost ?? 0), 0);
  const etims = finance.data?.settings?.etims_status ?? "not_connected";
  const [panel, setPanel] = useState<"invoice" | "expense" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [invoice, setInvoice] = useState({ package_id: "", customer_name: "", due_date: "", notes: "" });
  const [expense, setExpense] = useState({ supplier_name: "", category: "", amount: "", expense_date: new Date().toISOString().slice(0, 10), description: "", receipt_url: "" });
  const clearablePackages = rows.filter((r) => Boolean(r.paid_at) && !["collected", "released"].includes(r.status));

  const createInvoice = useMutation({
    mutationFn: async () => {
      const pkg = rows.find((x) => x.id === invoice.package_id);
      if (!pkg || !invoice.customer_name.trim()) throw new Error("Select a cleared package and enter the customer name.");
      const db = supabase as any;
      const amount = Number(pkg.cost ?? 0);
      const invoiceNumber = `DEX-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${String(Date.now()).slice(-6)}`;
      const { data: created, error } = await db.from("finance_invoices").insert({
        invoice_number: invoiceNumber, customer_name: invoice.customer_name.trim(), due_date: invoice.due_date || null,
        subtotal: amount, total: amount, package_ids: [pkg.id], notes: invoice.notes || null, created_by: employee?.user_id, status: "draft",
      }).select("id").single();
      if (error) throw error;
      const { error: itemError } = await db.from("finance_invoice_items").insert({ invoice_id: created.id, package_id: pkg.id, description: `Cargo package ${pkg.tracking_number ?? pkg.id}`, quantity: 1, unit_price: amount, line_total: amount });
      if (itemError) throw itemError;
      return invoiceNumber;
    },
    onSuccess: (number) => { setPanel(null); setInvoice({ package_id: "", customer_name: "", due_date: "", notes: "" }); setNotice(`Invoice ${number} created as a draft. Review and approve before any eTIMS submission.`); qc.invalidateQueries({ queryKey: ["finance-workspace"] }); },
    onError: (e: any) => setNotice(e?.message ?? "Invoice could not be created."),
  });
  const createExpense = useMutation({
    mutationFn: async () => {
      if (!expense.supplier_name.trim() || !expense.category.trim() || Number(expense.amount) <= 0) throw new Error("Supplier, category and a positive amount are required.");
      const { error } = await (supabase as any).from("finance_expenses").insert({ ...expense, amount: Number(expense.amount), receipt_url: expense.receipt_url || null, description: expense.description || null, submitted_by: employee?.user_id, status: "submitted" });
      if (error) throw error;
    },
    onSuccess: () => { setPanel(null); setExpense({ supplier_name: "", category: "", amount: "", expense_date: new Date().toISOString().slice(0, 10), description: "", receipt_url: "" }); setNotice("Expense submitted to the finance ledger for approval."); qc.invalidateQueries({ queryKey: ["finance-workspace"] }); },
    onError: (e: any) => setNotice(e?.message ?? "Expense could not be recorded."),
  });
  const closeMonth = useMutation({
    mutationFn: async () => { const { error } = await (supabase as any).rpc("finance_close_month", { _period: new Date().toISOString().slice(0, 7) + "-01", _note: "Closed from DEX Finance Workspace" }); if (error) throw error; },
    onSuccess: () => { setNotice("Current month closed. The finance snapshot and audit entry have been stored."); qc.invalidateQueries({ queryKey: ["finance-workspace"] }); },
    onError: (e: any) => setNotice(e?.message ?? "Month close failed."),
  });

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("approve_commission", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["desktop", "commissions"] }),
  });

  const markPaid = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("mark_commission_paid", { _id: id, _reference: `CONSOLE-${Date.now()}` });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["desktop", "commissions"] }),
  });

  const totals = comms.reduce(
    (acc, c) => {
      const a = Number(c.amount ?? 0);
      acc.all += a;
      acc[c.status as "pending" | "approved" | "paid"] += a;
      return acc;
    },
    { all: 0, pending: 0, approved: 0, paid: 0 },
  );

  const statusMix = (["pending", "approved", "paid"] as const)
    .map((s) => ({ name: s, value: comms.filter((c) => c.status === s).length }))
    .filter((s) => s.value > 0);

  const methodMix = Object.entries(
    pays.reduce<Record<string, number>>((acc, p) => {
      const k = p.method ?? "unknown";
      acc[k] = (acc[k] ?? 0) + Number(p.amount ?? 0);
      return acc;
    }, {}),
  ).map(([name, value]) => ({ name, value }));

  const days = lastNDays(14);
  const daily = days.map((d) => ({
    day: shortDay(d),
    settled: rows.filter((r) => dayKey(r.paid_at) === d).reduce((s, r) => s + Number(r.cost ?? 0), 0),
    commission: comms.filter((c) => dayKey(c.created_at) === d).reduce((s, c) => s + Number(c.amount ?? 0), 0),
  }));

  return (
    <div>
      <PageHead title="Finance workspace" subtitle={`${employee?.role === "finance_manager" ? "Finance Manager" : "Administrator"} · revenue, invoices, expenses and compliance`} action={<div className="flex gap-2"><button onClick={() => setPanel("expense")} className="px-3 py-2 rounded-lg border border-[--b1] text-[11px] font-bold">+ Expense</button><button onClick={() => setPanel("invoice")} className="px-3 py-2 rounded-lg bg-[--blue] text-white text-[11px] font-bold">+ Invoice</button></div>} />
      {notice && <div className="mb-4 rounded-lg border border-[--blue]/40 bg-[--blue]/10 px-3 py-2 text-[11px] text-[--t1] flex justify-between gap-3"><span>{notice}</span><button onClick={() => setNotice(null)} className="font-bold">×</button></div>}

      <div className="grid grid-cols-4 gap-4 mb-4">
        <Kpi label="Cleared revenue" value={fmtKES(financeRevenue)} hint="Packages with a recorded payment" tint="green" />
        <Kpi label="Operating expenses" value={fmtKES(expenseTotal)} hint={`${expenses.length} recorded expense items`} tint="orange" />
        <Kpi label="Receivables" value={fmtKES(outstandingInvoices.reduce((sum: number, x: any) => sum + Number(x.total ?? 0), 0))} hint={`${outstandingInvoices.length} invoice(s) pending settlement`} />
        <Kpi label="eTIMS readiness" value={String(etims).replaceAll("_", " ")} hint="Live submission remains disabled until KRA certification" tint="teal" />
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <Panel title="Invoice register" subtitle="Draft, approved and eTIMS submission states" className="col-span-2">
          <div className="max-h-[220px] overflow-y-auto"><table className="w-full text-[12px]"><thead className="text-[10px] uppercase tracking-wider text-[--t3]"><tr className="text-left"><th className="py-2">Invoice</th><th>Customer</th><th>Total</th><th>Status</th><th>Due</th></tr></thead><tbody>{invoices.slice(0, 12).map((x: any) => <tr key={x.id} className="border-t border-[--b1]"><td className="py-2 mono text-[--orange]">{x.invoice_number}</td><td>{x.customer_name}</td><td>{fmtKES(x.total)}</td><td className="capitalize">{x.status}</td><td className="text-[--t3]">{x.due_date ?? "—"}</td></tr>)}{!invoices.length && <tr><td colSpan={5} className="py-6 text-center text-[--t3]">No invoices yet. Create invoices from cleared packages after running the finance migration.</td></tr>}</tbody></table></div>
        </Panel>
        <Panel title="KRA / eTIMS control" subtitle="Compliance is deliberately controlled">
          <div className="text-lg font-bold capitalize">{String(etims).replaceAll("_", " ")}</div>
          <p className="text-[11px] text-[--t3] mt-2 leading-relaxed">Set the DEX legal name, KRA PIN, VAT status and branch before sandbox onboarding. Invoices retain an audit trail and eTIMS response fields; no tax invoice is sent automatically.</p>
          <div className="mt-3 text-[10px] font-bold uppercase tracking-wider text-[--orange]">Next: sandbox + certification</div>
        </Panel>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <Panel title="Expense register" subtitle="Receipts, supplier details and approval status" className="col-span-2">
          <div className="max-h-[200px] overflow-y-auto"><table className="w-full text-[12px]"><thead className="text-[10px] uppercase tracking-wider text-[--t3]"><tr className="text-left"><th className="py-2">Date</th><th>Supplier</th><th>Category</th><th>Amount</th><th>Status</th></tr></thead><tbody>{expenses.slice(0, 12).map((x: any) => <tr key={x.id} className="border-t border-[--b1]"><td className="py-2 text-[--t3]">{x.expense_date}</td><td>{x.supplier_name}</td><td>{x.category}</td><td>{fmtKES(x.amount)}</td><td className="capitalize">{x.status}</td></tr>)}{!expenses.length && <tr><td colSpan={5} className="py-6 text-center text-[--t3]">No expenses yet. The ledger is ready for receipt-backed expense entries.</td></tr>}</tbody></table></div>
        </Panel>
        <Panel title="Monthly close" subtitle="Protect finished periods">
          <div className="text-[11px] text-[--t3] leading-relaxed">Close each month after revenue, expenses and commissions are checked. A close stores the figures and provides an audit point for finance reporting.</div>
          <div className="mt-4 text-[12px] font-semibold">{finance.data?.closes?.length ?? 0} close record(s)</div>
          <button disabled={closeMonth.isPending} onClick={() => { if (window.confirm("Close the current month using the current ledger figures?")) closeMonth.mutate(); }} className="mt-3 text-[10px] font-bold uppercase tracking-wider text-[--orange] disabled:opacity-50">{closeMonth.isPending ? "Closing…" : "Close current month →"}</button>
        </Panel>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Kpi label="Commission total" value={fmtKES(totals.all)} />
        <Kpi label="Pending approval" value={fmtKES(totals.pending)} tint="orange" />
        <Kpi label="Approved" value={fmtKES(totals.approved)} tint="teal" />
        <Kpi label="Paid out" value={fmtKES(totals.paid)} tint="green" />
      </div>

      <div className="grid grid-cols-3 gap-4 mt-4">
        <Panel title="Settlement vs commission" subtitle="Last 14 days" className="col-span-2">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={daily} margin={{ left: -8, right: 8, top: 8 }}>
              <CartesianGrid stroke="#1F2937" vertical={false} />
              <XAxis dataKey="day" tick={axis} tickLine={false} axisLine={false} />
              <YAxis tick={axis} tickLine={false} axisLine={false} width={64} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => fmtKES(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 10, color: "#94A3B8" }} />
              <Line type="monotone" dataKey="settled" stroke="#10B981" strokeWidth={2} dot={false} name="Settled cargo" />
              <Line type="monotone" dataKey="commission" stroke="#F59E0B" strokeWidth={2} dot={false} name="Commission accrued" />
            </LineChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Commission status" subtitle="Entry count by state">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={statusMix} dataKey="value" nameKey="name" innerRadius={50} outerRadius={86} paddingAngle={3} stroke="none">
                {statusMix.map((s) => (
                  <Cell key={s.name} fill={COMMISSION_TINT[s.name] ?? "#64748B"} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 10, color: "#94A3B8" }} />
            </PieChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <div className="grid grid-cols-3 gap-4 mt-4">
        <Panel title="Payment method mix" subtitle="Value collected by channel">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={methodMix} margin={{ left: -16, right: 8, top: 8 }}>
              <CartesianGrid stroke="#1F2937" vertical={false} />
              <XAxis dataKey="name" tick={axis} tickLine={false} axisLine={false} />
              <YAxis tick={axis} tickLine={false} axisLine={false} width={60} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(16,185,129,0.08)" }} formatter={(v: any) => fmtKES(Number(v))} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {methodMix.map((m, i) => (
                  <Cell key={m.name} fill={METHOD_TINT[i % METHOD_TINT.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Commission ledger" subtitle="Approve or settle entries" className="col-span-2">
          <div className="max-h-[260px] overflow-y-auto">
            <table className="w-full text-[12px]">
              <thead className="text-[10px] uppercase tracking-wider text-[--t3]">
                <tr className="text-left">
                  <th className="py-2">Employee</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {comms.slice(0, 40).map((c) => (
                  <tr key={c.id} className="border-t border-[--b1]">
                    <td className="py-2 pr-2">
                      <div className="font-semibold">{c.employees?.full_name ?? "—"}</div>
                      <div className="text-[10px] text-[--t3]">{c.employees?.employee_code ?? ""}</div>
                    </td>
                    <td className="mono font-bold text-[--orange]">{fmtKES(c.amount)}</td>
                    <td className="capitalize text-[--t2]">{c.status}</td>
                    <td className="text-[--t3]">{fmtRelative(c.created_at)}</td>
                    <td className="text-right">
                      {employee?.role === "admin" && c.status === "pending" && (
                        <button onClick={() => approve.mutate(c.id)} className="text-[10px] font-bold uppercase tracking-wider text-[--blue] hover:text-[--t1]">
                          Approve
                        </button>
                      )}
                      {employee?.role === "admin" && c.status === "approved" && (
                        <button onClick={() => markPaid.mutate(c.id)} className="text-[10px] font-bold uppercase tracking-wider text-[--green] hover:text-[--t1]">
                          Mark paid
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {comms.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-[--t3] text-[11px]">No commission entries yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
      {panel === "invoice" && <FinanceModal title="Create customer invoice" onClose={() => setPanel(null)}><div className="grid gap-3"><Field label="Cleared package"><select value={invoice.package_id} onChange={(e) => { const p = rows.find((x) => x.id === e.target.value); setInvoice({ ...invoice, package_id: e.target.value, customer_name: p?.consignee ?? invoice.customer_name }); }} className={inputClass}><option value="">Choose a cleared package</option>{clearablePackages.map((p) => <option key={p.id} value={p.id}>{p.tracking_number ?? p.id} · {p.consignee} · {fmtKES(p.cost)}</option>)}</select></Field><Field label="Customer name"><input value={invoice.customer_name} onChange={(e) => setInvoice({ ...invoice, customer_name: e.target.value })} className={inputClass} /></Field><Field label="Due date"><input type="date" value={invoice.due_date} onChange={(e) => setInvoice({ ...invoice, due_date: e.target.value })} className={inputClass} /></Field><Field label="Internal note"><textarea value={invoice.notes} onChange={(e) => setInvoice({ ...invoice, notes: e.target.value })} className={inputClass} /></Field><button disabled={createInvoice.isPending} onClick={() => createInvoice.mutate()} className="py-3 rounded-lg bg-[--blue] text-white text-[11px] font-bold disabled:opacity-50">{createInvoice.isPending ? "Creating…" : "Create invoice draft"}</button></div></FinanceModal>}
      {panel === "expense" && <FinanceModal title="Record operating expense" onClose={() => setPanel(null)}><div className="grid gap-3"><Field label="Supplier"><input value={expense.supplier_name} onChange={(e) => setExpense({ ...expense, supplier_name: e.target.value })} className={inputClass} /></Field><Field label="Category"><select value={expense.category} onChange={(e) => setExpense({ ...expense, category: e.target.value })} className={inputClass}><option value="">Choose category</option><option>Freight & clearing</option><option>Warehouse</option><option>Delivery & fuel</option><option>Payroll</option><option>Office & utilities</option><option>Marketing</option><option>Other</option></select></Field><div className="grid grid-cols-2 gap-3"><Field label="Amount (KES)"><input type="number" min="0" value={expense.amount} onChange={(e) => setExpense({ ...expense, amount: e.target.value })} className={inputClass} /></Field><Field label="Expense date"><input type="date" value={expense.expense_date} onChange={(e) => setExpense({ ...expense, expense_date: e.target.value })} className={inputClass} /></Field></div><Field label="Receipt URL / storage path"><input value={expense.receipt_url} onChange={(e) => setExpense({ ...expense, receipt_url: e.target.value })} className={inputClass} placeholder="Optional; upload workflow can attach this" /></Field><Field label="Description"><textarea value={expense.description} onChange={(e) => setExpense({ ...expense, description: e.target.value })} className={inputClass} /></Field><button disabled={createExpense.isPending} onClick={() => createExpense.mutate()} className="py-3 rounded-lg bg-[--blue] text-white text-[11px] font-bold disabled:opacity-50">{createExpense.isPending ? "Saving…" : "Submit expense"}</button></div></FinanceModal>}
    </div>
  );
}

const inputClass = "w-full bg-[--s1] border border-[--b1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[--ring]";
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="grid gap-1"><span className="text-[10px] font-bold uppercase tracking-wider text-[--t3]">{label}</span>{children}</label>; }
function FinanceModal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) { return <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm grid place-items-center p-4"><div className="w-full max-w-lg bg-[--s2] border border-[--b1] rounded-2xl p-5 max-h-[90vh] overflow-y-auto"><div className="flex justify-between items-center mb-4"><div className="font-display text-lg font-extrabold">{title}</div><button onClick={onClose} className="text-xl text-[--t3]">×</button></div>{children}</div></div>; }

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell, Section } from "@/components/mobile/AppShell";
import { useEmployee } from "@/hooks/use-employee";
import { ROLE_LABELS } from "@/lib/format";
import {
  createEmployee,
  deleteEmployee,
  listEmployees,
  setEmployeeActive,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/employees")({
  head: () => ({ meta: [{ title: "Employees — DEXCARGO Ops" }] }),
  component: () => (
    <AppShell>
      <AdminEmployees />
    </AppShell>
  ),
});

function AdminEmployees() {
  const { employee, loading } = useEmployee();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const listFn = useServerFn(listEmployees);
  const createFn = useServerFn(createEmployee);
  const toggleFn = useServerFn(setEmployeeActive);
  const deleteFn = useServerFn(deleteEmployee);

  const list = useQuery({
    queryKey: ["admin-employees"],
    queryFn: () => listFn(),
    enabled: employee?.role === "admin",
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    password: "",
    role: "sales_rep" as "admin" | "sales_manager" | "logistics_manager" | "sales_rep",
    commission_percentage: 0,
  });
  const [err, setErr] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: async () =>
      createFn({
        data: {
          full_name: form.full_name.trim(),
          email: form.email.trim().toLowerCase(),
          phone: form.phone.trim() || null,
          password: form.password,
          role: form.role,
          commission_percentage: Number(form.commission_percentage) || 0,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-employees"] });
      setOpen(false);
      setForm({ full_name: "", email: "", phone: "", password: "", role: "sales_rep", commission_percentage: 0 });
      setErr(null);
    },
    onError: (e: any) => setErr(e?.message ?? "Failed to create employee"),
  });

  const toggleMut = useMutation({
    mutationFn: (v: { id: string; active: boolean }) =>
      toggleFn({ data: { employee_id: v.id, is_active: v.active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-employees"] }),
  });

  const deleteMut = useMutation({
    mutationFn: (employeeId: string) => deleteFn({ data: { employee_id: employeeId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-employees"] }),
    onError: (e: any) => setErr(e?.message ?? "Failed to delete employee"),
  });

  if (loading) return <div className="p-6 text-xs text-[--t2]">Loading…</div>;
  if (employee?.role !== "admin") {
    return (
      <div className="px-4 pt-6">
        <div className="card-surface p-4 text-sm">
          <div className="font-semibold">Admin only</div>
          <div className="text-xs text-[--t3] mt-1">You don't have permission to view this page.</div>
          <button onClick={() => navigate({ to: "/dashboard" })} className="mt-3 text-[11px] font-semibold text-[--orange]">
            ← Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-8">
      <section className="px-4 mt-2">
        <div className="card-elevated p-4 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[--orange]">Admin Console</div>
            <div className="font-display text-xl font-extrabold mt-1">Employees</div>
            <div className="text-[10px] text-[--t3] mt-0.5">{list.data?.length ?? 0} registered</div>
          </div>
          <button
            onClick={() => setOpen(true)}
            className="px-3 py-2 rounded-lg bg-[--blue] text-white text-[11px] font-bold uppercase tracking-wider"
          >
            + New
          </button>
        </div>
      </section>

      <Section title="Directory">
        <div className="flex flex-col gap-2">
          {(list.data ?? []).map((e: any) => (
            <div key={e.id} className="card-surface p-3">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="mono text-[11px] text-[--orange] font-semibold">{e.employee_code}</span>
                    <span
                      className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                        e.is_active ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-500/15 text-slate-300"
                      }`}
                    >
                      {e.is_active ? "Active" : "Disabled"}
                    </span>
                  </div>
                  <div className="text-sm font-semibold mt-1 truncate">{e.full_name}</div>
                  <div className="text-[10px] text-[--t3] mt-0.5 truncate">
                    {ROLE_LABELS[e.role]} · {e.email}
                  </div>
                </div>
                <div className="flex gap-3 text-[10px] font-semibold uppercase tracking-wider">
                  {e.id !== employee?.id && e.role !== "admin" && (
                    <button
                      onClick={() => toggleMut.mutate({ id: e.id, active: !e.is_active })}
                      className="text-[--t2] hover:text-[--t1]"
                    >
                      {e.is_active ? "Disable" : "Enable"}
                    </button>
                  )}
                  {e.id !== employee?.id && (
                    <button
                      disabled={deleteMut.isPending}
                      onClick={() => {
                        if (window.confirm(`Permanently delete ${e.full_name} (${e.employee_code})? Their login will be removed.`)) {
                          deleteMut.mutate(e.id);
                        }
                      }}
                      className="text-red-400 hover:text-red-300 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {list.isSuccess && (list.data ?? []).length === 0 && (
            <div className="text-xs text-[--t3] text-center py-6">No employees yet.</div>
          )}
        </div>
      </Section>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-3">
          <div className="w-full max-w-[440px] bg-[--s2] border border-[--b1] rounded-2xl p-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[--orange]">New employee</div>
                <div className="font-display text-lg font-extrabold">Register account</div>
              </div>
              <button onClick={() => setOpen(false)} className="text-[--t3] text-xl">×</button>
            </div>

            <div className="flex flex-col gap-2">
              <Field label="Full name">
                <input className={ipt} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
              </Field>
              <Field label="Email">
                <input type="email" className={ipt} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
              <Field label="Phone">
                <input className={ipt} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+2547…" />
              </Field>
              <Field label="Temporary password">
                <input type="text" className={ipt} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Min 8 chars" />
              </Field>
              <Field label="Role">
                <select className={ipt} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as any })}>
                  <option value="sales_rep">Sales Representative (SR)</option>
                  <option value="logistics_manager">Logistics Manager (LM)</option>
                  <option value="sales_manager">Sales Manager (SM)</option>
                  <option value="admin">Administrator (ADM)</option>
                </select>
              </Field>
              <Field label="Commission %">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  className={ipt}
                  value={form.commission_percentage}
                  onChange={(e) => setForm({ ...form, commission_percentage: Number(e.target.value) })}
                />
              </Field>
            </div>

            {err && <div className="mt-2 text-[11px] text-red-400 bg-red-500/10 border border-red-500/30 rounded-md p-2">{err}</div>}

            <button
              disabled={createMut.isPending || !form.full_name || !form.email || form.password.length < 8}
              onClick={() => createMut.mutate()}
              className="mt-4 w-full py-3 rounded-lg bg-[--blue] text-white text-[12px] font-bold uppercase tracking-wider disabled:opacity-50"
            >
              {createMut.isPending ? "Creating…" : "Create employee"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const ipt =
  "w-full bg-[--s1] border border-[--b1] rounded-lg px-3 py-2 text-sm placeholder:text-[--t3] focus:outline-none focus:ring-2 focus:ring-[--ring]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-wider text-[--t3]">{label}</span>
      {children}
    </label>
  );
}

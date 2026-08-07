import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Kpi, PageHead, Panel } from "@/components/desktop/DesktopShell";
import { useEmployee } from "@/hooks/use-employee";
import { ROLE_LABELS } from "@/lib/format";
import { createEmployee, deleteEmployee, listEmployees, setEmployeeActive } from "@/lib/admin.functions";

export const Route = createFileRoute("/desktop/employees")({
  head: () => ({
    meta: [
      { title: "Employees — DEXCARGO Admin Console" },
      { name: "description", content: "Register, enable, disable and remove DEXCARGO staff accounts with auto-assigned employee codes." },
      { property: "og:title", content: "DEXCARGO Staff Management" },
      { property: "og:description", content: "Register and manage DEXCARGO staff accounts and roles." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DesktopEmployees,
});

const ROLE_TINT = ["#3B6BF5", "#F59E0B", "#14B8A6", "#8B5CF6"];
const tooltipStyle = { background: "#111827", border: "1px solid #1F2937", borderRadius: 10, fontSize: 11, color: "#E2E8F0" };
const ipt = "w-full bg-[--s1] border border-[--b1] rounded-lg px-3 py-2 text-sm placeholder:text-[--t3] focus:outline-none focus:ring-2 focus:ring-[--ring]";

function DesktopEmployees() {
  const { employee } = useEmployee();
  const qc = useQueryClient();
  const listFn = useServerFn(listEmployees);
  const createFn = useServerFn(createEmployee);
  const toggleFn = useServerFn(setEmployeeActive);
  const deleteFn = useServerFn(deleteEmployee);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    password: "",
    role: "sales_rep" as "admin" | "sales_manager" | "logistics_manager" | "sales_rep",
    commission_percentage: 0,
  });

  const list = useQuery({ queryKey: ["admin-employees"], queryFn: () => listFn() });
  const people = (list.data ?? []) as any[];

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
      setErr(null);
      setForm({ full_name: "", email: "", phone: "", password: "", role: "sales_rep", commission_percentage: 0 });
    },
    onError: (e: any) => setErr(e?.message ?? "Failed to create employee"),
  });

  const toggleMut = useMutation({
    mutationFn: (v: { id: string; active: boolean }) => toggleFn({ data: { employee_id: v.id, is_active: v.active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-employees"] }),
    onError: (e: any) => setErr(e?.message ?? "Failed to update employee"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { employee_id: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-employees"] }),
    onError: (e: any) => setErr(e?.message ?? "Failed to delete employee"),
  });

  const roleMix = Object.entries(
    people.reduce<Record<string, number>>((acc, p) => {
      acc[p.role] = (acc[p.role] ?? 0) + 1;
      return acc;
    }, {}),
  ).map(([name, value]) => ({ name: ROLE_LABELS[name] ?? name, value }));

  return (
    <div>
      <PageHead
        title="Employees"
        subtitle={`${people.length} accounts · ${people.filter((p) => p.is_active).length} active`}
        action={
          <button onClick={() => setOpen(true)} className="px-4 py-2 rounded-lg bg-[--blue] text-white text-[11px] font-bold uppercase tracking-wider">
            + Register employee
          </button>
        }
      />

      <div className="grid grid-cols-4 gap-4">
        <Kpi label="Sales reps" value={String(people.filter((p) => p.role === "sales_rep").length)} />
        <Kpi label="Logistics managers" value={String(people.filter((p) => p.role === "logistics_manager").length)} tint="teal" />
        <Kpi label="Sales managers" value={String(people.filter((p) => p.role === "sales_manager").length)} tint="orange" />
        <Kpi label="Administrators" value={String(people.filter((p) => p.role === "admin").length)} tint="green" />
      </div>

      {err && <div className="mt-4 text-[11px] text-red-400 bg-red-500/10 border border-red-500/30 rounded-md p-2">{err}</div>}

      <div className="grid grid-cols-3 gap-4 mt-4">
        <Panel title="Directory" subtitle="Auto-assigned codes per role" className="col-span-2">
          <div className="max-h-[420px] overflow-y-auto">
            <table className="w-full text-[12px]">
              <thead className="text-[10px] uppercase tracking-wider text-[--t3]">
                <tr className="text-left">
                  <th className="py-2">Code</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {people.map((e) => (
                  <tr key={e.id} className="border-t border-[--b1]">
                    <td className="py-2 mono text-[--orange] font-semibold">{e.employee_code}</td>
                    <td className="font-semibold">{e.full_name}</td>
                    <td className="text-[--t2]">{ROLE_LABELS[e.role] ?? e.role}</td>
                    <td className="text-[--t3]">{e.email}</td>
                    <td>
                      <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${e.is_active ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-500/15 text-slate-300"}`}>
                        {e.is_active ? "Active" : "Disabled"}
                      </span>
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {e.id !== employee?.id && e.role !== "admin" && (
                        <button onClick={() => toggleMut.mutate({ id: e.id, active: !e.is_active })} className="text-[10px] font-bold uppercase tracking-wider text-[--t2] hover:text-[--t1] mr-3">
                          {e.is_active ? "Disable" : "Enable"}
                        </button>
                      )}
                      {e.id !== employee?.id && (
                        <button
                          disabled={deleteMut.isPending}
                          onClick={() => {
                            if (window.confirm(`Permanently delete ${e.full_name} (${e.employee_code})? Their login will be removed.`)) deleteMut.mutate(e.id);
                          }}
                          className="text-[10px] font-bold uppercase tracking-wider text-red-400 hover:text-red-300 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {list.isSuccess && people.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-[--t3] text-[11px]">No employees yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Role distribution" subtitle="Headcount by role">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={roleMix} dataKey="value" nameKey="name" innerRadius={50} outerRadius={88} paddingAngle={3} stroke="none">
                {roleMix.map((r, i) => (
                  <Cell key={r.name} fill={ROLE_TINT[i % ROLE_TINT.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 10, color: "#94A3B8" }} />
            </PieChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-[520px] bg-[--s2] border border-[--b1] rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[--orange]">New employee</div>
                <div className="font-display text-lg font-extrabold">Register account</div>
              </div>
              <button onClick={() => setOpen(false)} className="text-[--t3] text-xl">×</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Full name"><input className={ipt} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
              <Field label="Email"><input type="email" className={ipt} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
              <Field label="Phone"><input className={ipt} value={form.phone} placeholder="+2547…" onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
              <Field label="Temporary password"><input className={ipt} value={form.password} placeholder="Min 8 chars" onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
              <Field label="Role">
                <select className={ipt} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as any })}>
                  <option value="sales_rep">Sales Representative (SR)</option>
                  <option value="logistics_manager">Logistics Manager (LM)</option>
                  <option value="sales_manager">Sales Manager (SM)</option>
                  <option value="admin">Administrator (ADM)</option>
                </select>
              </Field>
              <Field label="Commission %">
                <input type="number" min={0} max={100} step="0.1" className={ipt} value={form.commission_percentage} onChange={(e) => setForm({ ...form, commission_percentage: Number(e.target.value) })} />
              </Field>
            </div>
            {err && <div className="mt-3 text-[11px] text-red-400 bg-red-500/10 border border-red-500/30 rounded-md p-2">{err}</div>}
            <button
              disabled={createMut.isPending || !form.full_name || !form.email || form.password.length < 8}
              onClick={() => createMut.mutate()}
              className="mt-5 w-full py-3 rounded-lg bg-[--blue] text-white text-[12px] font-bold uppercase tracking-wider disabled:opacity-50"
            >
              {createMut.isPending ? "Creating…" : "Create employee"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-wider text-[--t3]">{label}</span>
      {children}
    </label>
  );
}
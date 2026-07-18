import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/mobile/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { fmtKES, fmtRelative } from "@/lib/format";
import { useState } from "react";
import { useEmployee } from "@/hooks/use-employee";

export const Route = createFileRoute("/packages/$id")({
  head: () => ({ meta: [{ title: "Package — DEXCARGO Ops" }] }),
  component: () => <AppShell><Detail /></AppShell>,
});

function Detail() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { employee } = useEmployee();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const pkg = useQuery({
    queryKey: ["pkg", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("packages")
        .select("*, customers(*), warehouses(name, location), payments(*), status_history(*)")
        .eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  async function transition(newStatus: string, extra?: Record<string, unknown>) {
    setBusy(newStatus); setErr(null);
    try {
      const patch: Record<string, unknown> = { status: newStatus, ...(extra ?? {}) };
      const { error } = await supabase.from("packages").update(patch).eq("id", id);
      if (error) throw error;
      await supabase.from("status_history").insert({
        package_id: id,
        new_status: newStatus,
        changed_by: employee?.id ?? null,
      });
      await qc.invalidateQueries({ queryKey: ["pkg", id] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }

  if (pkg.isLoading) return <div className="p-6 text-sm text-[--t2]">Loading…</div>;
  if (!pkg.data) return <div className="p-6 text-sm text-[--t2]">Package not found. <button className="text-[--orange]" onClick={() => nav({ to: "/packages" })}>Go back</button></div>;

  const p = pkg.data as any;
  const total = Number(p.total_charges ?? 0);

  return (
    <div className="pb-8">
      <section className="px-4 mt-1">
        <div className="card-elevated p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="mono text-[11px] text-[--orange] font-semibold">{p.tracking_number}</div>
              <div className="font-display text-lg font-bold mt-0.5">{p.customers?.full_name ?? "—"}</div>
              <div className="text-[11px] text-[--t2] mt-0.5">{p.customers?.phone ?? ""}</div>
            </div>
            <StatusPill status={p.status} />
          </div>
          <div className="grid grid-cols-3 gap-2 mt-4 text-center">
            <Info label="Weight" value={p.weight_kg ? `${p.weight_kg} kg` : "—"} />
            <Info label="Pieces" value={String(p.pieces ?? 1)} />
            <Info label="Warehouse" value={p.warehouses?.name ?? "—"} />
          </div>
        </div>
      </section>

      {err && <div className="mx-4 mt-3 text-xs text-[--red] bg-[--red]/10 border border-[--red]/30 rounded-md p-2">{err}</div>}

      <section className="px-4 mt-4">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-[--t2] mb-2">Charges</h3>
        <div className="card-surface p-3 flex flex-col gap-1.5 text-sm">
          <Row label="Freight" value={fmtKES(p.freight_charges)} />
          <Row label="Clearance" value={fmtKES(p.clearance_charges)} />
          <Row label="Storage" value={fmtKES(p.storage_charges)} />
          <Row label="Other" value={fmtKES(p.other_charges)} />
          <div className="border-t border-[--b1] my-1" />
          <Row label="Total" value={fmtKES(total)} strong />
        </div>
        {p.status === "verified" && (
          <ChargesEditor packageId={id} onSaved={() => qc.invalidateQueries({ queryKey: ["pkg", id] })} />
        )}
      </section>

      <section className="px-4 mt-4">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-[--t2] mb-2">Actions</h3>
        <div className="flex flex-col gap-2">
          {p.status === "received" && (
            <ActionBtn label="Verify package" busy={busy === "verified"} onClick={() => transition("verified")} />
          )}
          {p.status === "awaiting_payment" && (
            <PaymentPanel pkg={p} employeeId={employee?.id ?? null} onDone={() => qc.invalidateQueries({ queryKey: ["pkg", id] })} />
          )}
          {p.status === "paid" && (
            <ActionBtn label="Mark ready for collection" busy={busy === "ready_for_collection"} onClick={() => transition("ready_for_collection")} />
          )}
          {p.status === "ready_for_collection" && (
            <CollectPanel packageId={id} onDone={() => qc.invalidateQueries({ queryKey: ["pkg", id] })} />
          )}
          {p.status === "collected" && (
            <ActionBtn label="Mark cleared" busy={busy === "cleared"} onClick={() => transition("cleared")} />
          )}
        </div>
      </section>

      <section className="px-4 mt-5">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-[--t2] mb-2">Timeline</h3>
        <div className="card-surface p-3 flex flex-col gap-2">
          {(p.status_history ?? []).length === 0 && <div className="text-xs text-[--t3]">No transitions yet.</div>}
          {(p.status_history ?? []).slice().sort((a: any, b: any) => a.created_at.localeCompare(b.created_at)).map((h: any) => (
            <div key={h.id} className="flex items-center gap-2 text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-[--orange]" />
              <span className="font-semibold">{h.new_status}</span>
              <span className="text-[--t3] ml-auto">{fmtRelative(h.created_at)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[--s1] border border-[--b1] rounded-md p-2">
      <div className="text-[9.5px] font-semibold uppercase tracking-wider text-[--t3]">{label}</div>
      <div className="text-sm font-semibold mt-0.5">{value}</div>
    </div>
  );
}
function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "font-bold text-[--orange]" : "text-[--t2]"}`}>
      <span>{label}</span><span className="mono">{value}</span>
    </div>
  );
}
function ActionBtn({ label, onClick, busy, variant = "primary" }: { label: string; onClick: () => void; busy?: boolean; variant?: "primary" | "ghost" }) {
  const cls = variant === "primary" ? "bg-[--blue] text-white" : "bg-[--s2] text-[--t1] border border-[--b1]";
  return <button onClick={onClick} disabled={busy} className={`py-3 rounded-lg text-sm font-semibold disabled:opacity-50 ${cls}`}>{busy ? "Working…" : label}</button>;
}

function ChargesEditor({ packageId, onSaved }: { packageId: string; onSaved: () => void }) {
  const [freight, setFreight] = useState("");
  const [clearance, setClearance] = useState("");
  const [storage, setStorage] = useState("");
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const f = Number(freight || 0), c = Number(clearance || 0), s = Number(storage || 0), o = Number(other || 0);
    const total = f + c + s + o;
    await supabase.from("packages").update({
      freight_charges: f, clearance_charges: c, storage_charges: s, other_charges: o,
      total_charges: total, status: "awaiting_payment",
    }).eq("id", packageId);
    await supabase.from("status_history").insert({ package_id: packageId, new_status: "awaiting_payment" });
    setBusy(false); onSaved();
  }

  return (
    <div className="mt-3 card-surface p-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[--t2] mb-2">Enter charges (KES)</div>
      <div className="grid grid-cols-2 gap-2">
        <MiniField label="Freight" value={freight} onChange={setFreight} />
        <MiniField label="Clearance" value={clearance} onChange={setClearance} />
        <MiniField label="Storage" value={storage} onChange={setStorage} />
        <MiniField label="Other" value={other} onChange={setOther} />
      </div>
      <button onClick={save} disabled={busy} className="mt-3 w-full py-3 rounded-lg bg-[--orange] text-black text-sm font-bold disabled:opacity-50">
        {busy ? "Saving…" : "Save & request payment"}
      </button>
    </div>
  );
}

function MiniField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <div className="text-[10px] text-[--t3] font-semibold uppercase tracking-wider mb-1">{label}</div>
      <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-[--s1] border border-[--b1] rounded-md px-2.5 py-2 text-sm mono focus:outline-none focus:ring-2 focus:ring-[--ring]" />
    </label>
  );
}

function PaymentPanel({ pkg, employeeId, onDone }: { pkg: any; employeeId: string | null; onDone: () => void }) {
  const [phone, setPhone] = useState(pkg.customers?.phone ?? "");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState<"stk" | "manual" | null>(null);
  const total = Number(pkg.total_charges ?? 0);

  async function record(method: "mpesa_stk" | "mpesa_manual", providerRef: string) {
    const { error } = await supabase.from("payments").insert({
      package_id: pkg.id,
      amount: total,
      method,
      status: "success",
      mpesa_receipt: providerRef,
      phone_number: phone,
      processed_by: employeeId,
    });
    if (error) throw error;
    await supabase.from("packages").update({ status: "paid" }).eq("id", pkg.id);
    await supabase.from("status_history").insert({ package_id: pkg.id, new_status: "paid", changed_by: employeeId });
  }

  return (
    <div className="card-surface p-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[--t2]">Collect payment</div>
      <div className="font-display text-2xl font-extrabold text-[--orange] mt-1">{fmtKES(total)}</div>
      <div className="mt-3 flex flex-col gap-2">
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Customer M-Pesa phone (2547…)"
          className="w-full bg-[--s1] border border-[--b1] rounded-md px-3 py-2.5 text-sm mono focus:outline-none focus:ring-2 focus:ring-[--ring]" />
        <button disabled={!!busy} onClick={async () => {
          setBusy("stk");
          try {
            // Stub STK Push — records a pending success with a synthetic ref
            const ref = "STK" + Date.now().toString().slice(-8);
            await record("mpesa_stk", ref);
            onDone();
          } finally { setBusy(null); }
        }} className="py-3 rounded-lg bg-[--green] text-white text-sm font-bold disabled:opacity-50">
          {busy === "stk" ? "Sending STK…" : "Send STK Push"}
        </button>
        <div className="flex items-center gap-2">
          <input value={ref} onChange={(e) => setRef(e.target.value.toUpperCase())} placeholder="Manual receipt (e.g. QK7X…)" className="flex-1 bg-[--s1] border border-[--b1] rounded-md px-3 py-2.5 text-sm mono uppercase focus:outline-none focus:ring-2 focus:ring-[--ring]" />
          <button disabled={!ref || !!busy} onClick={async () => { setBusy("manual"); try { await record("mpesa_manual", ref); onDone(); } finally { setBusy(null); } }}
            className="px-3 py-2.5 rounded-md bg-[--s2] border border-[--b1] text-xs font-bold disabled:opacity-50">
            Record
          </button>
        </div>
      </div>
    </div>
  );
}

function CollectPanel({ packageId, onDone }: { packageId: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="card-surface p-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[--t2] mb-2">Release to customer</div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Recipient full name" className="w-full bg-[--s1] border border-[--b1] rounded-md px-3 py-2.5 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-[--ring]" />
      <input value={id} onChange={(e) => setId(e.target.value)} placeholder="ID / passport number" className="w-full bg-[--s1] border border-[--b1] rounded-md px-3 py-2.5 text-sm mono mb-2 focus:outline-none focus:ring-2 focus:ring-[--ring]" />
      <button disabled={busy || !name} onClick={async () => {
        setBusy(true);
        await supabase.from("deliveries").insert({ package_id: packageId, recipient_name: name, recipient_id: id, delivered_at: new Date().toISOString() });
        await supabase.from("packages").update({ status: "collected" }).eq("id", packageId);
        await supabase.from("status_history").insert({ package_id: packageId, new_status: "collected" });
        setBusy(false); onDone();
      }} className="w-full py-3 rounded-lg bg-[--teal] text-white text-sm font-bold disabled:opacity-50">
        {busy ? "Recording…" : "Confirm collection"}
      </button>
    </div>
  );
}
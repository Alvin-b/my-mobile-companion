import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/mobile/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { fmtKES, fmtRelative } from "@/lib/format";
import { useState } from "react";
import { useEmployee } from "@/hooks/use-employee";
import type { Database } from "@/integrations/supabase/types";

type Status = Database["public"]["Enums"]["package_status"];

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
        .select("*, customers(*), warehouses(name, city), payments(*), package_status_history(*)")
        .eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  async function transition(to: Status, notes?: string) {
    setBusy(to); setErr(null);
    try {
      const { error } = await supabase.rpc("transition_package_status", {
        _package_id: id, _to: to, _by: employee?.id ?? undefined, _notes: notes,
      });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["pkg", id] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }

  if (pkg.isLoading) return <div className="p-6 text-sm text-[--t2]">Loading…</div>;
  if (!pkg.data) return (
    <div className="p-6 text-sm text-[--t2]">
      Package not found. <button className="text-[--orange]" onClick={() => nav({ to: "/packages" })}>Go back</button>
    </div>
  );

  const p = pkg.data as any;
  const total = Number(p.amount_due ?? 0);

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
            <Info label="Courier" value={p.courier ?? "—"} />
            <Info label="Bin" value={p.bin_code ?? "—"} />
          </div>
          {p.description && <div className="mt-3 text-xs text-[--t2]"><span className="text-[--t3]">Description: </span>{p.description}</div>}
        </div>
      </section>

      {err && <div className="mx-4 mt-3 text-xs text-[--red] bg-[--red]/10 border border-[--red]/30 rounded-md p-2">{err}</div>}

      <section className="px-4 mt-4">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-[--t2] mb-2">Amount due</h3>
        <div className="card-surface p-3 flex items-center justify-between">
          <span className="text-[--t2] text-sm">Total charges</span>
          <span className="mono font-bold text-[--orange] text-lg">{fmtKES(total)}</span>
        </div>
        {(p.status === "received" || p.status === "verified") && (
          <ChargesEditor packageId={id} initial={total} onSaved={() => qc.invalidateQueries({ queryKey: ["pkg", id] })} employeeId={employee?.id ?? null} />
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
            <CollectPanel packageId={id} employeeId={employee?.id ?? null} onDone={() => { qc.invalidateQueries({ queryKey: ["pkg", id] }); }} onTransition={() => transition("collected")} />
          )}
          {p.status === "collected" && (
            <ActionBtn label="Mark cleared" busy={busy === "cleared"} onClick={() => transition("cleared")} />
          )}
        </div>
      </section>

      <section className="px-4 mt-5">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-[--t2] mb-2">Timeline</h3>
        <div className="card-surface p-3 flex flex-col gap-2">
          {(p.package_status_history ?? []).length === 0 && <div className="text-xs text-[--t3]">No transitions yet.</div>}
          {(p.package_status_history ?? []).slice().sort((a: any, b: any) => a.created_at.localeCompare(b.created_at)).map((h: any) => (
            <div key={h.id} className="flex items-center gap-2 text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-[--orange]" />
              <span className="font-semibold capitalize">{String(h.to_status).replace(/_/g, " ")}</span>
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
function ActionBtn({ label, onClick, busy }: { label: string; onClick: () => void; busy?: boolean }) {
  return <button onClick={onClick} disabled={busy} className="py-3 rounded-lg bg-[--blue] text-white text-sm font-semibold disabled:opacity-50">{busy ? "Working…" : label}</button>;
}

function ChargesEditor({ packageId, initial, employeeId, onSaved }: { packageId: string; initial: number; employeeId: string | null; onSaved: () => void }) {
  const [amount, setAmount] = useState(String(initial || ""));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true); setErr(null);
    try {
      const n = Number(amount || 0);
      const { error: uErr } = await supabase.from("packages").update({ amount_due: n }).eq("id", packageId);
      if (uErr) throw uErr;
      const { error: tErr } = await supabase.rpc("transition_package_status", {
        _package_id: packageId, _to: "awaiting_payment", _by: employeeId ?? undefined,
        _notes: "Charges set: " + n,
      });
      if (tErr) throw tErr;
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-3 card-surface p-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[--t2] mb-2">Set amount due (KES)</div>
      <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
        className="w-full bg-[--s1] border border-[--b1] rounded-md px-3 py-2.5 text-sm mono focus:outline-none focus:ring-2 focus:ring-[--ring]"
        placeholder="0" />
      {err && <div className="mt-2 text-xs text-[--red]">{err}</div>}
      <button onClick={save} disabled={busy} className="mt-3 w-full py-3 rounded-lg bg-[--orange] text-black text-sm font-bold disabled:opacity-50">
        {busy ? "Saving…" : "Save & request payment"}
      </button>
    </div>
  );
}

function PaymentPanel({ pkg, employeeId, onDone }: { pkg: any; employeeId: string | null; onDone: () => void }) {
  const [phone, setPhone] = useState<string>(pkg.customers?.phone ?? "");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState<"stk" | "manual" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const total = Number(pkg.amount_due ?? 0);

  async function record(method: "mpesa_stk" | "mpesa_manual", providerRef: string) {
    setErr(null);
    const { error: pErr } = await supabase.from("payments").insert({
      package_id: pkg.id, amount: total, method, status: "paid",
      mpesa_receipt: providerRef, phone, received_by_employee_id: employeeId,
      paid_at: new Date().toISOString(),
    });
    if (pErr) throw pErr;
    const { error: tErr } = await supabase.rpc("transition_package_status", {
      _package_id: pkg.id, _to: "paid", _by: employeeId ?? undefined, _notes: `${method} · ${providerRef}`,
    });
    if (tErr) throw tErr;
  }

  return (
    <div className="card-surface p-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[--t2]">Collect payment</div>
      <div className="font-display text-2xl font-extrabold text-[--orange] mt-1">{fmtKES(total)}</div>
      <div className="mt-3 flex flex-col gap-2">
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Customer M-Pesa phone (2547…)"
          className="w-full bg-[--s1] border border-[--b1] rounded-md px-3 py-2.5 text-sm mono focus:outline-none focus:ring-2 focus:ring-[--ring]" />
        <button disabled={!!busy || !phone} onClick={async () => {
          setBusy("stk");
          setErr(null); setNotice(null);
          try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error("Your session has expired. Please sign in again.");
            const response = await fetch("/api/mpesa-stk-push", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
              body: JSON.stringify({ phone, amount: total, tracking_number: pkg.tracking_number, description: pkg.description ?? "DEX payment" }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error ?? "Unable to start the STK push");
            setNotice("STK prompt sent. The package will update when Safaricom confirms payment.");
            onDone();
          }
          catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
          finally { setBusy(null); }
        }} className="py-3 rounded-lg bg-[--green] text-white text-sm font-bold disabled:opacity-50">
          {busy === "stk" ? "Sending STK…" : "Send STK Push"}
        </button>
        <div className="flex items-center gap-2">
          <input value={ref} onChange={(e) => setRef(e.target.value.toUpperCase())} placeholder="Manual receipt (QK7X…)"
            className="flex-1 bg-[--s1] border border-[--b1] rounded-md px-3 py-2.5 text-sm mono uppercase focus:outline-none focus:ring-2 focus:ring-[--ring]" />
          <button disabled={!ref || !!busy} onClick={async () => {
            setBusy("manual");
            try { await record("mpesa_manual", ref); onDone(); }
            catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
            finally { setBusy(null); }
          }} className="px-3 py-2.5 rounded-md bg-[--s2] border border-[--b1] text-xs font-bold disabled:opacity-50">
            Record
          </button>
        </div>
        {err && <div className="text-xs text-[--red]">{err}</div>}
        {notice && <div className="text-xs text-emerald-400">{notice}</div>}
      </div>
    </div>
  );
}

function CollectPanel({ packageId, employeeId, onDone, onTransition }: { packageId: string; employeeId: string | null; onDone: () => void; onTransition: () => Promise<void> | void }) {
  const [name, setName] = useState("");
  const [idn, setIdn] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const { error } = await supabase.from("deliveries").insert({
        package_id: packageId,
        collected_by_name: name,
        collected_by_id_number: idn,
        collected_by_phone: phone,
        released_by_employee_id: employeeId,
      });
      if (error) throw error;
      await onTransition();
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <div className="card-surface p-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[--t2] mb-2">Release to customer</div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Recipient full name" className="w-full bg-[--s1] border border-[--b1] rounded-md px-3 py-2.5 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-[--ring]" />
      <input value={idn} onChange={(e) => setIdn(e.target.value)} placeholder="ID / passport" className="w-full bg-[--s1] border border-[--b1] rounded-md px-3 py-2.5 text-sm mono mb-2 focus:outline-none focus:ring-2 focus:ring-[--ring]" />
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" className="w-full bg-[--s1] border border-[--b1] rounded-md px-3 py-2.5 text-sm mono mb-2 focus:outline-none focus:ring-2 focus:ring-[--ring]" />
      {err && <div className="text-xs text-[--red] mb-2">{err}</div>}
      <button disabled={busy || !name} onClick={submit} className="w-full py-3 rounded-lg bg-[--teal] text-white text-sm font-bold disabled:opacity-50">
        {busy ? "Recording…" : "Confirm collection"}
      </button>
    </div>
  );
}

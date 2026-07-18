import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/mobile/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { useEmployee } from "@/hooks/use-employee";

export const Route = createFileRoute("/scan")({
  head: () => ({ meta: [{ title: "Intake — DEXCARGO Ops" }] }),
  component: () => <AppShell><Scan /></AppShell>,
});

function Scan() {
  const nav = useNavigate();
  const { employee } = useEmployee();
  const [step, setStep] = useState<"scan" | "form">("scan");
  const [tracking, setTracking] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [weight, setWeight] = useState("");
  const [courier, setCourier] = useState("");
  const [desc, setDesc] = useState("");
  const [notes, setNotes] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function autoTracking() {
    const { data, error } = await supabase.rpc("generate_tracking_number");
    if (!error && data) setTracking(String(data));
  }

  async function submit() {
    setBusy(true); setErr(null);
    try {
      // upsert customer by phone
      let customerId: string | null = null;
      if (customerPhone.trim()) {
        const { data: existing } = await supabase.from("customers").select("id").eq("phone", customerPhone.trim()).maybeSingle();
        if (existing) customerId = existing.id;
        else {
          const { data, error } = await supabase.from("customers").insert({
            phone: customerPhone.trim(),
            full_name: customerName.trim() || "Unknown",
            created_by: employee?.id ?? null,
          }).select("id").single();
          if (error) throw error;
          customerId = data.id;
        }
      }
      const insert: Parameters<typeof supabase.from>[0] extends "packages" ? never : never = null as never; // typing helper
      void insert;
      const trackingNumber = tracking || `PKG-${Date.now().toString(36).toUpperCase()}`;
      const { data: pkg, error: pErr } = await supabase.from("packages").insert({
        tracking_number: trackingNumber,
        customer_id: customerId,
        courier: courier || null,
        description: desc || null,
        special_notes: notes || null,
        weight_kg: weight ? Number(weight) : null,
        amount_due: amount ? Number(amount) : null,
        received_by_employee_id: employee?.id ?? null,
      }).select("id").single();
      if (pErr) throw pErr;
      // commission-on-receipt
      if (employee && (employee.commission_percentage ?? 0) > 0 && amount) {
        const commissionAmt = (Number(amount) * Number(employee.commission_percentage)) / 100;
        await supabase.from("commissions").insert({
          employee_id: employee.id,
          package_id: pkg.id,
          amount: commissionAmt,
          percentage: employee.commission_percentage,
          trigger: "received",
        });
      }
      nav({ to: "/packages/$id", params: { id: pkg.id } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  if (step === "scan") {
    return (
      <div className="px-4 pb-8">
        <div className="mt-2 card-elevated p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[--orange]">Intake · Step 1</div>
          <div className="mt-2 font-display text-lg font-bold">Scan the sticker</div>
          <div className="mt-1 text-xs text-[--t2]">Point the camera at the courier barcode. Or enter details manually — camera scanning activates on the packaged app.</div>
          <div className="mt-4 aspect-square rounded-xl border-2 border-dashed border-[--b2] bg-[--s1] flex items-center justify-center text-[--t3]">
            <div className="text-center">
              <div className="text-4xl">📷</div>
              <div className="text-[11px] mt-2 font-semibold uppercase tracking-wider">Camera preview</div>
            </div>
          </div>
          <button onClick={() => { autoTracking(); setStep("form"); }} className="mt-4 w-full py-3 rounded-lg bg-[--blue] text-white text-sm font-semibold">
            Continue to intake form
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pb-8">
      <div className="mt-2 card-elevated p-4">
        <div className="text-[10px] font-bold uppercase tracking-wider text-[--orange]">Intake · Step 2</div>
        <div className="mt-2 font-display text-lg font-bold">Package details</div>
        <div className="mt-4 grid grid-cols-1 gap-3">
          <Field label="Tracking #">
            <input value={tracking} onChange={(e) => setTracking(e.target.value)} className={ic} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Customer phone"><input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} className={ic} placeholder="2547…" /></Field>
            <Field label="Customer name"><input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className={ic} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Weight (kg)"><input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} className={ic} /></Field>
            <Field label="Courier"><input value={courier} onChange={(e) => setCourier(e.target.value)} className={ic} placeholder="DHL, Aramex…" /></Field>
          </div>
          <Field label="Description"><input value={desc} onChange={(e) => setDesc(e.target.value)} className={ic} placeholder="1 carton — clothing" /></Field>
          <Field label="Amount due (KES, optional)"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={ic} /></Field>
          <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={ic + " min-h-[72px]"} /></Field>
        </div>
        {err && <div className="mt-3 text-xs text-[--red] bg-[--red]/10 border border-[--red]/30 rounded-md p-2">{err}</div>}
        <div className="mt-4 flex gap-2">
          <button onClick={() => setStep("scan")} className="flex-1 py-3 rounded-lg bg-[--s2] border border-[--b1] text-sm font-semibold">Back</button>
          <button onClick={submit} disabled={busy} className="flex-[2] py-3 rounded-lg bg-[--orange] text-black text-sm font-bold disabled:opacity-50">
            {busy ? "Registering…" : "Register package"}
          </button>
        </div>
      </div>
    </div>
  );
}

const ic = "w-full bg-[--s1] border border-[--b1] rounded-md px-3 py-2.5 text-sm placeholder:text-[--t3] focus:outline-none focus:ring-2 focus:ring-[--ring]";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[--t3] mb-1">{label}</div>
      {children}
    </label>
  );
}
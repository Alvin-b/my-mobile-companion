import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { initiateMpesaStkPush, getMpesaStkStatus } from "@/lib/mpesa.functions";

export const Route = createFileRoute("/mpesa-test")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  component: MpesaTestPage,
  head: () => ({
    meta: [
      { title: "M-Pesa STK Test" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

type StatusRow = {
  id: string;
  status: string | null;
  mpesa_receipt: string | null;
  result_code: string | null;
  result_desc: string | null;
  amount: number | null;
  sender_phone: string | null;
  checkout_request_id: string | null;
  account_reference: string | null;
} | null;

function MpesaTestPage() {
  const initiate = useServerFn(initiateMpesaStkPush);
  const getStatus = useServerFn(getMpesaStkStatus);

  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("1");
  const [tracking, setTracking] = useState("");
  const [description, setDescription] = useState("Test");

  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initResult, setInitResult] = useState<Awaited<ReturnType<typeof initiateMpesaStkPush>> | null>(null);
  const [status, setStatus] = useState<StatusRow>(null);
  const [log, setLog] = useState<string[]>([]);

  function append(msg: string) {
    setLog((l) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...l].slice(0, 30));
  }

  async function onInitiate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInitResult(null);
    setStatus(null);
    setLoading(true);
    try {
      const res = await initiate({
        data: {
          phone,
          amount: parseInt(amount, 10),
          tracking_number: tracking,
          description: description || undefined,
        },
      });
      setInitResult(res);
      append(`STK push sent → notification ${res.notification_id}`);
      pollStatus(res.notification_id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      append(`ERROR: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  async function pollStatus(notificationId: string) {
    setPolling(true);
    const started = Date.now();
    const timeoutMs = 120_000;
    try {
      while (Date.now() - started < timeoutMs) {
        const row = (await getStatus({ data: { notification_id: notificationId } })) as StatusRow;
        setStatus(row);
        append(`Status: ${row?.status ?? "unknown"}${row?.result_desc ? ` — ${row.result_desc}` : ""}`);
        if (row?.status && row.status !== "PENDING") break;
        await new Promise((r) => setTimeout(r, 3000));
      }
    } catch (err) {
      append(`Poll error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPolling(false);
    }
  }

  async function refreshOnce() {
    if (!initResult) return;
    const row = (await getStatus({ data: { notification_id: initResult.notification_id } })) as StatusRow;
    setStatus(row);
    append(`Manual refresh: ${row?.status ?? "unknown"}`);
  }

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">M-Pesa STK Push — Test Console</h1>
        <p className="text-sm text-muted-foreground">
          Initiate a Daraja STK push and watch the payment_notifications row transition. Delete this route when done.
        </p>
      </header>

      <form onSubmit={onInitiate} className="space-y-3 rounded-lg border border-border p-4">
        <Field label="Phone (07XX / 2547XX / +2547XX)">
          <input
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0712345678"
            required
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (KES)">
            <input
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              type="number"
              min={1}
              required
            />
          </Field>
          <Field label="Tracking number (an existing package awaiting payment)">
            <input
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              required
            />
          </Field>
        </div>
        <Field label="Description (≤13 chars sent to Daraja)">
          <input
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {loading ? "Sending…" : "Initiate STK Push"}
        </button>
      </form>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {initResult && (
        <section className="rounded-lg border border-border p-4 space-y-2 text-sm">
          <h2 className="font-medium">Initiation Response</h2>
          <KV k="notification_id" v={initResult.notification_id} />
          <KV k="notification_number" v={initResult.notification_number} />
          <KV k="checkout_request_id" v={initResult.checkout_request_id ?? "—"} />
          <KV k="merchant_request_id" v={initResult.merchant_request_id ?? "—"} />
          <KV k="customer_message" v={initResult.customer_message ?? "—"} />
        </section>
      )}

      {initResult && (
        <section className="rounded-lg border border-border p-4 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Live Status {polling && <span className="text-muted-foreground">(polling…)</span>}</h2>
            <button
              onClick={refreshOnce}
              className="rounded-md border border-input px-3 py-1 text-xs"
            >
              Refresh
            </button>
          </div>
          {status ? (
            <>
              <KV k="status" v={status.status ?? "—"} />
              <KV k="result_code" v={status.result_code ?? "—"} />
              <KV k="result_desc" v={status.result_desc ?? "—"} />
              <KV k="mpesa_receipt" v={status.mpesa_receipt ?? "—"} />
              <KV k="amount" v={String(status.amount ?? "—")} />
              <KV k="sender_phone" v={status.sender_phone ?? "—"} />
            </>
          ) : (
            <p className="text-muted-foreground">No status yet…</p>
          )}
        </section>
      )}

      <section className="rounded-lg border border-border p-4">
        <h2 className="font-medium text-sm mb-2">Log</h2>
        <pre className="text-xs whitespace-pre-wrap font-mono max-h-64 overflow-auto">
          {log.length ? log.join("\n") : "—"}
        </pre>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 font-mono text-xs">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right break-all">{v}</span>
    </div>
  );
}

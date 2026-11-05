import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PageHead, Panel, Kpi } from "@/components/desktop/DesktopShell";
import { supabase } from "@/integrations/supabase/client";
import { fmtKES, fmtRelative } from "@/lib/format";

export const Route = createFileRoute("/desktop/payment-control")({
  head: () => ({ meta: [{ title: "Payment Control — DEXCARGO Admin Console" }] }),
  component: PaymentControl,
});

type PackageLink = {
  allocation_id: string;
  tracking_number: string;
  consignee: string | null;
  allocated_amount: number;
  cost: number | null;
  status: string | null;
};
type Evidence = {
  id: string;
  notification_number: string | null;
  evidence_type: string | null;
  evidence_url: string | null;
  text_content: string | null;
  note: string | null;
  amount: number | null;
  sender_phone: string | null;
  status: string | null;
  uploaded_at: string | null;
  linked_packages: PackageLink[];
  allocated_total: number;
};

async function authFetch(path: string, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Sign in again to manage payment evidence.");
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${data.session.access_token}`,
      "Content-Type": "application/json",
    },
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error ?? "Payment action failed.");
  return json;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function PaymentControl() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "PENDING" | "LINKED">("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Evidence | null>(null);
  const [amount, setAmount] = useState("");
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const evidence = useQuery({
    queryKey: ["desktop", "payment-evidence", filter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "200" });
      if (filter !== "all") params.set("status", filter);
      return (await authFetch(`/api/public/payment-evidence?${params}`)).evidence as Evidence[];
    },
  });
  const action = useMutation({
    mutationFn: async (input: { method: "PATCH" | "DELETE"; body: Record<string, unknown> }) =>
      authFetch("/api/public/admin/payment-control", {
        method: input.method,
        body: JSON.stringify(input.body),
      }),
    onSuccess: () => {
      setEditing(null);
      setReason("");
      setNotice("Payment record updated and audit trail saved.");
      qc.invalidateQueries({ queryKey: ["desktop", "payment-evidence"] });
    },
    onError: (e: unknown) => setNotice(errorMessage(e, "Payment action failed.")),
  });
  const unlink = useMutation({
    mutationFn: (allocation_id: string) =>
      authFetch("/api/public/admin/payment-control", {
        method: "DELETE",
        body: JSON.stringify({
          allocation_id,
          reason: reason.trim() || "Admin corrected an incorrect package allocation.",
        }),
      }),
    onSuccess: () => {
      setNotice("Package unlinked and payment audit recorded.");
      setReason("");
      qc.invalidateQueries({ queryKey: ["desktop", "payment-evidence"] });
    },
    onError: (e: unknown) => setNotice(errorMessage(e, "Package could not be unlinked.")),
  });
  const rows = (evidence.data ?? []).filter((row) => {
    const needle = query.trim().toLowerCase();
    return (
      !needle ||
      [
        row.notification_number,
        row.text_content,
        row.sender_phone,
        ...row.linked_packages.map((p) => `${p.tracking_number} ${p.consignee ?? ""}`),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  });
  const pending = rows.filter((r) => r.status === "PENDING").length;
  const linked = rows.filter((r) => r.status === "LINKED").length;
  const total = rows.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
  function openEdit(row: Evidence) {
    setEditing(row);
    setAmount(row.amount == null ? "" : String(row.amount));
    setText(row.text_content ?? "");
    setReason("");
    setNotice(null);
  }
  function saveEdit() {
    if (!editing || reason.trim().length < 5)
      return setNotice("Enter a correction reason of at least 5 characters.");
    action.mutate({
      method: "PATCH",
      body: {
        payment_notification_id: editing.id,
        amount: amount === "" ? null : Number(amount),
        text_content: text || null,
        reason: reason.trim(),
      },
    });
  }
  function deleteEvidence(row: Evidence) {
    if (row.linked_packages.length)
      return setNotice("Unlink every package before deleting this evidence.");
    if (reason.trim().length < 5)
      return setNotice("Enter a deletion reason of at least 5 characters first.");
    if (
      window.confirm(
        `Delete payment evidence ${row.notification_number ?? row.id}? This action is audited.`,
      )
    )
      action.mutate({
        method: "DELETE",
        body: { payment_notification_id: row.id, reason: reason.trim() },
      });
  }
  return (
    <div>
      <PageHead
        title="Payment control"
        subtitle="Review evidence, correct extracted totals, unlink allocations and delete records as an administrator."
      />
      <div className="grid grid-cols-4 gap-4 mb-4">
        <Kpi label="Visible evidence" value={String(rows.length)} />
        <Kpi label="Waiting to link" value={String(pending)} tint="orange" />
        <Kpi label="Linked evidence" value={String(linked)} tint="green" />
        <Kpi label="Evidence total" value={fmtKES(total)} tint="teal" />
      </div>
      {notice && (
        <div className="mb-4 rounded-lg border border-[--orange]/30 bg-[--orange]/10 px-3 py-2 text-[11px] text-[--t1]">
          {notice}
        </div>
      )}
      <Panel
        title="Evidence register"
        subtitle="Images are visible as thumbnails; open them for the full proof."
      >
        <div className="flex gap-2 mb-4">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search receipt, sender or tracking number"
            className="flex-1 bg-[--s1] border border-[--b1] rounded-lg px-3 py-2 text-sm"
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as "all" | "PENDING" | "LINKED")}
            className="bg-[--s1] border border-[--b1] rounded-lg px-3 py-2 text-sm"
          >
            <option value="all">All evidence</option>
            <option value="PENDING">Waiting to link</option>
            <option value="LINKED">Linked evidence</option>
          </select>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-[12px] min-w-[980px]">
            <thead className="text-[10px] uppercase tracking-wider text-[--t3]">
              <tr className="text-left">
                <th className="py-2">Proof</th>
                <th>Receipt / sender</th>
                <th>Extracted amount</th>
                <th>Allocation</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-[--b1] align-top">
                  <td className="py-3">
                    {row.evidence_url ? (
                      <a href={row.evidence_url} target="_blank" rel="noreferrer">
                        <img
                          src={row.evidence_url}
                          alt="Payment evidence"
                          className="w-16 h-16 object-cover rounded-lg border border-[--b1] hover:ring-2 hover:ring-[--blue]"
                        />
                      </a>
                    ) : (
                      <div className="w-16 h-16 rounded-lg bg-[--s1] grid place-items-center text-[10px] text-[--t3]">
                        TEXT
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="mono text-[--orange]">{row.notification_number ?? row.id}</div>
                    <div className="text-[--t2]">{row.sender_phone ?? "No sender number"}</div>
                    <div className="text-[10px] text-[--t3] mt-1 max-w-[330px] whitespace-pre-wrap">
                      {row.text_content ?? "No message text"}
                    </div>
                    <div className="text-[10px] text-[--t3] mt-1">
                      {fmtRelative(row.uploaded_at)}
                    </div>
                  </td>
                  <td className="mono font-bold text-[--green]">
                    {row.amount == null ? "—" : fmtKES(row.amount)}
                  </td>
                  <td>
                    <div className="mono font-bold">{fmtKES(row.allocated_total)}</div>
                    {row.linked_packages.length ? (
                      <div className="mt-1 grid gap-1">
                        {row.linked_packages.map((p) => (
                          <div
                            key={p.allocation_id}
                            className="flex items-center gap-2 text-[10px]"
                          >
                            <span className="text-[--t2]">
                              {p.tracking_number} · {fmtKES(p.allocated_amount)}
                            </span>
                            <button
                              onClick={() => {
                                if (window.confirm(`Unlink ${p.tracking_number}?`))
                                  unlink.mutate(p.allocation_id);
                              }}
                              className="text-red-300 font-bold"
                            >
                              Unlink
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[10px] text-[--t3]">Not linked</span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`px-2 py-1 rounded text-[9px] font-bold uppercase ${row.status === "LINKED" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}
                    >
                      {row.status ?? "UNKNOWN"}
                    </span>
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <button
                      onClick={() => openEdit(row)}
                      className="text-[10px] font-bold text-[--blue] mr-3"
                    >
                      Correct
                    </button>
                    <button
                      onClick={() => deleteEvidence(row)}
                      className="text-[10px] font-bold text-red-300"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-[--t3]">
                    No payment evidence matches this view.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm grid place-items-center p-4">
          <div className="w-full max-w-lg bg-[--s2] border border-[--b1] rounded-2xl p-5">
            <div className="flex justify-between items-center mb-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[--orange]">
                  Payment correction
                </div>
                <div className="font-display text-lg font-extrabold">
                  {editing.notification_number ?? editing.id}
                </div>
              </div>
              <button onClick={() => setEditing(null)} className="text-xl text-[--t3]">
                ×
              </button>
            </div>
            <label className="grid gap-1 text-[10px] font-bold uppercase tracking-wider text-[--t3]">
              Total amount
              <input
                type="number"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="bg-[--s1] border border-[--b1] rounded-lg px-3 py-2 text-sm normal-case"
              />
            </label>
            <label className="grid gap-1 text-[10px] font-bold uppercase tracking-wider text-[--t3] mt-3">
              Payment message
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="bg-[--s1] border border-[--b1] rounded-lg px-3 py-2 text-sm normal-case min-h-24"
              />
            </label>
            <label className="grid gap-1 text-[10px] font-bold uppercase tracking-wider text-[--t3] mt-3">
              Audit reason
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this record being corrected?"
                className="bg-[--s1] border border-[--b1] rounded-lg px-3 py-2 text-sm normal-case min-h-20"
              />
            </label>
            <button
              disabled={action.isPending}
              onClick={saveEdit}
              className="mt-4 w-full py-3 rounded-lg bg-[--blue] text-white text-[11px] font-bold"
            >
              {action.isPending ? "Saving…" : "Save correction"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function fmtKES(n: number | string | null | undefined): string {
  const v = typeof n === "string" ? parseFloat(n) : n ?? 0;
  if (!isFinite(v as number)) return "KES 0";
  return "KES " + (v as number).toLocaleString("en-KE", { maximumFractionDigits: 0 });
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + "d ago";
  return d.toLocaleDateString();
}

export const STATUS_LABELS: Record<string, string> = {
  received: "Received",
  verified: "Verified",
  awaiting_payment: "Awaiting Payment",
  paid: "Paid",
  ready_for_collection: "Ready",
  collected: "Collected",
  cleared: "Cleared",
};

export const STATUS_COLORS: Record<string, string> = {
  received: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  verified: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  awaiting_payment: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  paid: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  ready_for_collection: "bg-teal-500/15 text-teal-300 border-teal-500/30",
  collected: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  cleared: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

export const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  sales_manager: "Sales Manager",
  logistics_manager: "Logistics Manager",
  sales_rep: "Sales Representative",
};
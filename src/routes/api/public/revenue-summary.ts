import { createFileRoute } from "@tanstack/react-router";
import { verifyStaffJwt } from "@/lib/storage-sign.server";

// Company-wide money position for the admin dashboard.
// Revenue = value of every cargo package that has been paid for (either via
// M-Pesa STK or by an admin linking uploaded payment evidence to it).
//
// Auth: Supabase JWT of an active staff member.
// GET /api/public/revenue-summary

export const Route = createFileRoute("/api/public/revenue-summary")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await verifyStaffJwt(request);
        if (!user) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: packages, error } = await supabaseAdmin
          .from("cargo_packages")
          .select("id, status, cost, paid_at, registered_at, collected_at");
        if (error) return new Response(error.message, { status: 500 });

        const { data: commissions, error: commissionError } = await supabaseAdmin
          .from("commissions")
          .select("amount, status");
        if (commissionError) return new Response(commissionError.message, { status: 500 });

        const now = new Date();
        const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).getTime();
        const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).getTime();

        const rows = packages ?? [];
        const paid = rows.filter((r) => Boolean(r.paid_at));
        const value = (r: { cost: number | null }) => Number(r.cost ?? 0);
        const sum = (list: typeof rows) => list.reduce((total, r) => total + value(r), 0);
        const paidAt = (r: { paid_at: string | null }) => (r.paid_at ? new Date(r.paid_at).getTime() : 0);

        const grossRevenue = sum(paid);
        const isReleased = (r: (typeof rows)[number]) =>
          Boolean(r.collected_at) || ["collected", "cleared", "released"].includes(r.status);
        const released = rows.filter(isReleased);
        const pending = rows.filter((r) => !isReleased(r));
        const outstanding = sum(rows.filter((r) => !r.paid_at));
        const commissionRows = commissions ?? [];
        const commissionTotal = commissionRows.reduce((t, c) => t + Number(c.amount ?? 0), 0);
        const commissionPaid = commissionRows
          .filter((c) => c.status === "paid")
          .reduce((t, c) => t + Number(c.amount ?? 0), 0);

        return Response.json(
          {
            currency: "KES",
            generated_at: new Date().toISOString(),
            revenue: {
              total: grossRevenue,
              today: sum(paid.filter((r) => paidAt(r) >= startOfDay)),
              this_month: sum(paid.filter((r) => paidAt(r) >= startOfMonth)),
            },
            gross_income: {
              total: sum(released),
              released_count: released.length,
            },
            pending_release: {
              value: sum(pending),
              count: pending.length,
            },
            packages: {
              total: rows.length,
              paid: paid.length,
              unpaid: rows.length - paid.length,
              outstanding_value: outstanding,
            },
            commissions: {
              accrued: commissionTotal,
              paid_out: commissionPaid,
              outstanding: commissionTotal - commissionPaid,
            },
            net_retained: grossRevenue - commissionTotal,
          },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
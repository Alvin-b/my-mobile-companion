import { createFileRoute } from "@tanstack/react-router";
import { verifyStaffJwt } from "@/lib/storage-sign.server";

// Company-wide money position for administrator and finance-manager dashboards.
export const Route = createFileRoute("/api/public/revenue-summary")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await verifyStaffJwt(request);
        if (!user) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: actor, error: actorError } = await supabaseAdmin
          .from("employees")
          .select("role,is_active")
          .eq("user_id", user.id)
          .maybeSingle();
        if (actorError) return new Response(actorError.message, { status: 500 });
        if (
          !actor?.is_active ||
          !["admin", "finance_manager"].includes(String(actor.role).toLowerCase())
        ) {
          return Response.json(
            { error: "Administrator or finance manager access is required" },
            { status: 403 },
          );
        }

        const { data: packages, error } = await supabaseAdmin
          .from("cargo_packages")
          .select("id, status, payment_status, cost, paid_at, registered_at, collected_at");
        if (error) return new Response(error.message, { status: 500 });

        const { data: commissions, error: commissionError } = await supabaseAdmin
          .from("commissions")
          .select("amount, status");
        if (commissionError) return new Response(commissionError.message, { status: 500 });

        const now = new Date();
        const startOfDay = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
        ).getTime();
        const startOfMonth = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
        ).getTime();

        const rows = packages ?? [];
        const paid = rows.filter((row) => row.payment_status === "paid" || Boolean(row.paid_at));
        const value = (row: { cost: number | null }) => Number(row.cost ?? 0);
        const sum = (list: typeof rows) => list.reduce((total, row) => total + value(row), 0);
        const paidAt = (row: { paid_at: string | null }) =>
          row.paid_at ? new Date(row.paid_at).getTime() : 0;

        const grossRevenue = sum(paid);
        const isReleased = (row: (typeof rows)[number]) => Boolean(row.collected_at);
        const released = rows.filter(isReleased);
        const pending = rows.filter((row) => !isReleased(row));
        const outstanding = sum(
          rows.filter((row) => row.payment_status !== "paid" && !row.paid_at),
        );
        const commissionRows = commissions ?? [];
        const commissionTotal = commissionRows.reduce(
          (total, commission) => total + Number(commission.amount ?? 0),
          0,
        );
        const commissionPaid = commissionRows
          .filter((commission) => commission.status === "paid")
          .reduce((total, commission) => total + Number(commission.amount ?? 0), 0);

        return Response.json(
          {
            currency: "KES",
            generated_at: new Date().toISOString(),
            revenue: {
              total: grossRevenue,
              today: sum(paid.filter((row) => paidAt(row) >= startOfDay)),
              this_month: sum(paid.filter((row) => paidAt(row) >= startOfMonth)),
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

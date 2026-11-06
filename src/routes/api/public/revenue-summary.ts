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
          .select("id, tracking_number, status, payment_status, cost, total_price_kes, billing_amount, billing_currency, paid_at, registered_at, imported_at, created_at, collected_at");
        if (error) return new Response(error.message, { status: 500 });

        const { data: allocations, error: allocationError } = await supabaseAdmin
          .from("payment_allocations")
          .select("order_id,tracking_number,allocated_amount");
        if (allocationError) return new Response(allocationError.message, { status: 500 });

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
        const startOfNextMonth = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
        ).getTime();

        const rows = packages ?? [];
        const paid = rows.filter((row) => row.payment_status === "paid" || Boolean(row.paid_at));
        const value = (row: (typeof rows)[number]) => {
          const primary = row.total_price_kes ?? row.cost;
          if (primary != null) return Number(primary) || 0;
          return String(row.billing_currency ?? "").toUpperCase() === "KES"
            ? Number(row.billing_amount ?? 0) || 0
            : 0;
        };
        const sum = (list: typeof rows) => list.reduce((total, row) => total + value(row), 0);
        const timestamp = (value: string | null | undefined) => {
          const parsed = value ? new Date(value).getTime() : 0;
          return Number.isFinite(parsed) ? parsed : 0;
        };
        const paidAt = (row: (typeof rows)[number]) =>
          row.paid_at ? new Date(row.paid_at).getTime() : 0;

        const grossRevenue = sum(paid);
        const isReleased = (row: (typeof rows)[number]) => Boolean(row.collected_at);
        const released = rows.filter(isReleased);
        const pending = rows.filter((row) => !isReleased(row));
        const packageById = new Map(rows.map((row) => [String(row.id), row]));
        const packageByTracking = new Map(
          rows.filter((row) => row.tracking_number).map((row) => [String(row.tracking_number), row]),
        );
        const allocatedByPackage = new Map<string, number>();
        for (const allocation of allocations ?? []) {
          const pkg =
            packageById.get(String(allocation.order_id ?? "")) ??
            packageByTracking.get(String(allocation.tracking_number ?? ""));
          if (!pkg) continue;
          const id = String(pkg.id);
          allocatedByPackage.set(
            id,
            (allocatedByPackage.get(id) ?? 0) + Number(allocation.allocated_amount ?? 0),
          );
        }
        const awaitingPayment = rows.filter((row) => row.payment_status !== "paid" && !row.paid_at);
        const outstanding = awaitingPayment.reduce(
          (total, row) =>
            total + Math.max(0, value(row) - (allocatedByPackage.get(String(row.id)) ?? 0)),
          0,
        );
        const registeredThisMonth = rows.filter((row) => {
          const created = timestamp(row.registered_at ?? row.imported_at ?? row.created_at);
          return created >= startOfMonth && created < startOfNextMonth;
        }).length;
        const paidThisMonth = paid.filter((row) => {
          const date = paidAt(row);
          return date >= startOfMonth && date < startOfNextMonth;
        });
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
              this_month: sum(paidThisMonth),
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
              unpaid: awaitingPayment.length,
              pending_payment_count: awaitingPayment.length,
              registered_this_month: registeredThisMonth,
              paid_this_month: paidThisMonth.length,
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

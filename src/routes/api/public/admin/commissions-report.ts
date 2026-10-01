import { createFileRoute } from "@tanstack/react-router";
import { requireActiveAdmin } from "@/lib/admin-api.server";
import { ApiError } from "@/lib/admin-api";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/admin/commissions-report")({
  server: { handlers: {
    GET: async ({ request }) => {
      try {
        await requireActiveAdmin(request);
        const url = new URL(request.url);
        const month = url.searchParams.get("month") ?? "";
        if (!/^\d{4}-\d{2}$/.test(month)) return Response.json({ error: "Choose a valid report month (YYYY-MM)." }, { status: 400 });
        const start = new Date(`${month}-01T00:00:00.000Z`);
        if (Number.isNaN(start.valueOf()) || start.toISOString().slice(0, 7) !== month) return Response.json({ error: "Choose a valid report month." }, { status: 400 });
        const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
        const { data: commissions, error } = await supabaseAdmin.from("commissions").select("*")
          .gte("created_at", start.toISOString()).lt("created_at", end.toISOString())
          .order("created_at", { ascending: true }).range(0, 9999);
        if (error) throw new ApiError(500, error.message);
        const eligibleRows = (commissions ?? []).filter((row) => row.employee_id);
        const ids = [...new Set(eligibleRows.map((row) => String(row.employee_id)))];
        const { data: employees, error: employeeError } = ids.length
          ? await supabaseAdmin.from("employees").select("id,full_name,role").in("id", ids)
          : { data: [], error: null };
        if (employeeError) throw new ApiError(500, employeeError.message);
        const byId = new Map((employees ?? []).map((employee) => [String(employee.id), employee]));
        const rows = eligibleRows.filter((row) => !["admin", "finance_manager"].includes(String(byId.get(String(row.employee_id))?.role ?? "").toLowerCase()))
          .map((row) => ({ ...row, employee_name: byId.get(String(row.employee_id))?.full_name ?? "Unknown employee" }));
        return Response.json({ month, commissions: rows, row_count: rows.length }, { headers: { "cache-control": "no-store" } });
      } catch (error) {
        if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
        console.error("[admin/commissions-report]", error);
        return Response.json({ error: "Unable to load the monthly commissions report" }, { status: 500 });
      }
    },
  } },
});

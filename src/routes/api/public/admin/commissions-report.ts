import { createFileRoute } from "@tanstack/react-router";
import { requireActiveAdmin } from "@/lib/admin-api.server";
import { ApiError } from "@/lib/admin-api";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function periodBounds(
  month: string,
  year: string,
): {
  start: Date;
  end: Date;
  label: string;
  response: { month?: string; year?: string };
} {
  if (month && year) throw new ApiError(400, "Choose either month or year, not both.");
  if (!month && !year)
    throw new ApiError(400, "Choose a valid report month (YYYY-MM) or year (YYYY).");

  if (month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new ApiError(400, "Choose a valid report month (YYYY-MM).");
    }
    const start = new Date(`${month}-01T00:00:00.000Z`);
    if (Number.isNaN(start.valueOf()) || start.toISOString().slice(0, 7) !== month) {
      throw new ApiError(400, "Choose a valid report month.");
    }
    return {
      start,
      end: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)),
      label: month,
      response: { month },
    };
  }

  if (!/^\d{4}$/.test(year)) throw new ApiError(400, "Choose a valid report year (YYYY).");
  const yearNumber = Number(year);
  if (yearNumber < 1970 || yearNumber > 9999)
    throw new ApiError(400, "Choose a valid report year.");
  return {
    start: new Date(Date.UTC(yearNumber, 0, 1)),
    end: new Date(Date.UTC(yearNumber + 1, 0, 1)),
    label: year,
    response: { year },
  };
}

export const Route = createFileRoute("/api/public/admin/commissions-report")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await requireActiveAdmin(request);
          const url = new URL(request.url);
          const month = url.searchParams.get("month")?.trim() ?? "";
          const year = url.searchParams.get("year")?.trim() ?? "";
          const employeeId = url.searchParams.get("employee_id")?.trim() ?? "";
          const period = periodBounds(month, year);

          let query = supabaseAdmin
            .from("commissions")
            .select("*")
            .gte("created_at", period.start.toISOString())
            .lt("created_at", period.end.toISOString())
            .order("created_at", { ascending: true })
            .range(0, 9999);
          if (employeeId) query = query.eq("employee_id", employeeId);
          const { data: commissions, error } = await query;
          if (error) throw new ApiError(500, error.message);

          const eligibleRows = (commissions ?? []).filter((row) => row.employee_id);
          const ids = [...new Set(eligibleRows.map((row) => String(row.employee_id)))];
          const { data: employees, error: employeeError } = ids.length
            ? await supabaseAdmin.from("employees").select("id,full_name,role").in("id", ids)
            : { data: [], error: null };
          if (employeeError) throw new ApiError(500, employeeError.message);
          const byId = new Map(
            (employees ?? []).map((employee) => [String(employee.id), employee]),
          );
          const rows = eligibleRows
            .filter(
              (row) =>
                !["admin", "finance_manager"].includes(
                  String(byId.get(String(row.employee_id))?.role ?? "").toLowerCase(),
                ),
            )
            .map((row) => ({
              ...row,
              employee_name: byId.get(String(row.employee_id))?.full_name ?? "Unknown employee",
            }));

          return Response.json(
            {
              ...period.response,
              period: period.label,
              employee_id: employeeId || null,
              commissions: rows,
              row_count: rows.length,
            },
            { headers: { "cache-control": "no-store" } },
          );
        } catch (error) {
          if (error instanceof ApiError)
            return Response.json({ error: error.message }, { status: error.status });
          console.error("[admin/commissions-report]", error);
          return Response.json({ error: "Unable to load the commissions report" }, { status: 500 });
        }
      },
    },
  },
});

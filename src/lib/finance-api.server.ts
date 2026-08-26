import { verifyStaffJwt } from "@/lib/storage-sign.server";

export class FinanceApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Checks the JWT and active company role before a finance action is performed. */
export async function requireFinanceAccess(request: Request) {
  const user = await verifyStaffJwt(request);
  if (!user) throw new FinanceApiError(401, "Unauthorized");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: employee, error } = await supabaseAdmin
    .from("employees")
    .select("role,is_active")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new FinanceApiError(500, error.message);
  if (!employee?.is_active || !["admin", "finance_manager"].includes(employee.role)) {
    throw new FinanceApiError(403, "Finance Manager or administrator access is required");
  }
  return { user, supabaseAdmin, role: employee.role };
}

export function financeErrorResponse(error: unknown) {
  if (error instanceof FinanceApiError) return Response.json({ error: error.message }, { status: error.status });
  console.error("[finance api]", error);
  return Response.json({ error: "Internal server error" }, { status: 500 });
}

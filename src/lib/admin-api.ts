import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const appRoles = ["admin", "sales_manager", "logistics_manager", "sales_rep"] as const;
type AppRole = (typeof appRoles)[number];

const rolePrefix: Record<AppRole, string> = {
  admin: "ADM",
  sales_manager: "SM",
  logistics_manager: "LM",
  sales_rep: "SR",
};

export const createEmployeeInput = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().trim().min(2),
  phone: z.string().trim().min(7).max(30).nullable().optional(),
  role: z.enum(appRoles),
  commission_percentage: z.number().min(0).max(100).optional(),
});

export const setEmployeeActiveInput = z.object({
  employee_id: z.string().uuid(),
  is_active: z.boolean(),
});

export const deleteEmployeeInput = z.object({
  employee_id: z.string().uuid(),
});

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    throw new ApiError(401, "A Supabase access token is required");
  }
  const token = authorization.slice(7).trim();
  if (!token) throw new ApiError(401, "A Supabase access token is required");
  return token;
}

export async function requireActiveAdmin(request: Request) {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) throw new ApiError(500, "Supabase is not configured");

  const token = bearerToken(request);
  const userResponse = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: publishableKey, Authorization: `Bearer ${token}` },
  });
  if (!userResponse.ok) throw new ApiError(401, "Invalid or expired access token");
  const user = (await userResponse.json()) as { id: string };

  const { data: employee, error } = await supabaseAdmin
    .from("employees")
    .select("id, employee_code, role, is_active")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new ApiError(500, error.message);
  if (!employee || !employee.is_active || employee.role !== "admin") {
    throw new ApiError(403, "Active administrator access is required");
  }
  return { userId: user.id, employee };
}

async function nextEmployeeCode(role: AppRole): Promise<string> {
  const prefix = rolePrefix[role];
  const { data, error } = await supabaseAdmin
    .from("employees")
    .select("employee_code")
    .like("employee_code", `${prefix}-%`);
  if (error) throw new ApiError(500, error.message);

  const highest = (data ?? []).reduce((maximum, row) => {
    const match = /-(\d+)$/.exec(row.employee_code);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0);
  return `${prefix}-${String(highest + 1).padStart(4, "0")}`;
}

export async function createManagedEmployee(input: z.infer<typeof createEmployeeInput>) {
  const employeeCode = await nextEmployeeCode(input.role);
  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: input.email.toLowerCase(),
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.full_name },
  });
  if (createError || !created.user) {
    throw new ApiError(400, createError?.message ?? "Unable to create the authentication account");
  }

  const userId = created.user.id;
  const { data: employee, error: employeeError } = await supabaseAdmin
    .from("employees")
    .insert({
      user_id: userId,
      employee_code: employeeCode,
      full_name: input.full_name,
      email: input.email.toLowerCase(),
      phone: input.phone || null,
      role: input.role,
      commission_percentage: input.commission_percentage ?? 0,
      is_active: true,
    })
    .select("id, employee_code, full_name, email, phone, role, commission_percentage, is_active, created_at")
    .single();
  if (employeeError || !employee) {
    await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => undefined);
    throw new ApiError(400, employeeError?.message ?? "Unable to create the employee record");
  }

  const { error: roleError } = await supabaseAdmin.from("user_roles").insert({ user_id: userId, role: input.role });
  if (roleError) {
    await supabaseAdmin.from("employees").delete().eq("id", employee.id);
    await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => undefined);
    throw new ApiError(400, roleError.message);
  }

  return { ...employee, user_id: userId };
}

export async function listManagedEmployees() {
  const { data, error } = await supabaseAdmin
    .from("employees")
    .select("id, user_id, employee_code, full_name, email, phone, role, commission_percentage, is_active, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new ApiError(500, error.message);
  return data ?? [];
}

export async function setManagedEmployeeActive(input: z.infer<typeof setEmployeeActiveInput>, actorEmployeeId: string) {
  if (input.employee_id === actorEmployeeId) throw new ApiError(400, "You cannot deactivate your own account");
  const { data: target, error: targetError } = await supabaseAdmin
    .from("employees")
    .select("employee_code, role")
    .eq("id", input.employee_id)
    .maybeSingle();
  if (targetError) throw new ApiError(500, targetError.message);
  if (!target) throw new ApiError(404, "Employee not found");
  if (target.role === "admin") throw new ApiError(400, "Administrator accounts cannot be deactivated here");

  const { error } = await supabaseAdmin.from("employees").update({ is_active: input.is_active }).eq("id", input.employee_id);
  if (error) throw new ApiError(500, error.message);
}

export async function deleteManagedEmployee(input: z.infer<typeof deleteEmployeeInput>, actorEmployeeId: string) {
  if (input.employee_id === actorEmployeeId) throw new ApiError(400, "You cannot delete your own account");
  const { data: target, error: targetError } = await supabaseAdmin
    .from("employees")
    .select("id, user_id, employee_code, role")
    .eq("id", input.employee_id)
    .maybeSingle();
  if (targetError) throw new ApiError(500, targetError.message);
  if (!target) throw new ApiError(404, "Employee not found");
  if (target.role === "admin") throw new ApiError(400, "Administrator accounts cannot be deleted");

  // Preserve historical package/payment references while removing access.
  const { error: deactivateError } = await supabaseAdmin
    .from("employees")
    .update({ is_active: false })
    .eq("id", target.id);
  if (deactivateError) throw new ApiError(500, deactivateError.message);

  if (target.user_id) {
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(target.user_id);
    if (deleteError) {
      await supabaseAdmin.from("employees").update({ is_active: true }).eq("id", target.id);
      throw new ApiError(500, deleteError.message);
    }
  }
  return { employee_id: target.id, employee_code: target.employee_code };
}

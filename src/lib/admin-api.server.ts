import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  ApiError,
  type AppRole,
  rolePrefix,
  createEmployeeInput,
  setEmployeeActiveInput,
  deleteEmployeeInput,
} from "@/lib/admin-api";

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
  const email = input.email.trim().toLowerCase();

  // Reject a duplicate email up-front so the admin gets a clear message
  // instead of a raw auth/database conflict.
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("employees")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  if (existingError) throw new ApiError(500, existingError.message);
  if (existing) throw new ApiError(409, `The email ${email} is already registered to another employee`);

  const employeeCode = await nextEmployeeCode(input.role);
  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.full_name },
  });
  if (createError || !created.user) {
    const message = createError?.message ?? "Unable to create the authentication account";
    const duplicate = /already|registered|exists/i.test(message);
    throw new ApiError(duplicate ? 409 : 400, duplicate ? `The email ${email} is already registered` : message);
  }

  const userId = created.user.id;
  const { data: employee, error: employeeError } = await supabaseAdmin
    .from("employees")
    .insert({
      user_id: userId,
      employee_code: employeeCode,
      full_name: input.full_name,
      email,
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

  const { error: deleteError } = await supabaseAdmin.from("employees").delete().eq("id", target.id);
  if (deleteError) throw new ApiError(500, deleteError.message);

  if (target.user_id) {
    await supabaseAdmin.from("user_roles").delete().eq("user_id", target.user_id);
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(target.user_id);
    if (authError) throw new ApiError(500, authError.message);
  }
  return { employee_id: target.id, employee_code: target.employee_code };
}

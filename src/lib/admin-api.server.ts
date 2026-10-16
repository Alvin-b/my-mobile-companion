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
    const protectedPassword = /weak|easy to guess|compromised|password/i.test(message);
    throw new ApiError(
      duplicate ? 409 : 400,
      duplicate
        ? `The email ${email} is already registered`
        : protectedPassword
          ? "This password is blocked by the Supabase Auth security setting. Disable leaked-password protection in Supabase Authentication settings if you want to permit it."
          : message,
    );
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

export async function updateManagedEmployee(input: { employee_id: string; full_name: string; email: string; phone: string | null; role: AppRole }, actorEmployeeId: string) {
  const { data: initialTarget, error: initialTargetError } = await supabaseAdmin.from("employees")
    .select("id,user_id,role,email").eq("id", input.employee_id).maybeSingle();
  if (initialTargetError) throw new ApiError(400, `Unable to load the employee record: ${initialTargetError.message}`);
  // Older desktop builds could send the auth user UUID instead of the
  // employee-row UUID. Resolve that safely for backward compatibility.
  let target = initialTarget;
  if (!target) {
    const { data: userTarget, error: userTargetError } = await supabaseAdmin.from("employees")
      .select("id,user_id,role,email").eq("user_id", input.employee_id).maybeSingle();
    if (userTargetError) throw new ApiError(400, `Unable to resolve the employee account: ${userTargetError.message}`);
    target = userTarget;
  }
  if (!target) throw new ApiError(404, "Employee not found");
  const employeeId = target.id;
  if (employeeId === actorEmployeeId && input.role !== "admin") throw new ApiError(400, "You cannot remove administrator access from your own account");
  if (target.role === "admin" && input.role !== "admin" && target.id === actorEmployeeId) throw new ApiError(400, "You cannot demote your own administrator account");
  const email = input.email.trim().toLowerCase();
  const { data: duplicate, error: duplicateError } = await supabaseAdmin.from("employees").select("id").ilike("email", email).neq("id", employeeId).maybeSingle();
  if (duplicateError) throw new ApiError(400, `Unable to validate the employee email: ${duplicateError.message}`);
  if (duplicate) throw new ApiError(409, "That email address belongs to another employee");

  // Keep the employee table usable even when an older installation has a
  // stale/missing profile row. A profile email conflict is reported before
  // Auth is changed instead of surfacing as an opaque 500 halfway through.
  if (target.user_id) {
    const { data: duplicateProfile, error: duplicateProfileError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("email", email)
      .neq("id", target.user_id)
      .maybeSingle();
    if (duplicateProfileError && duplicateProfileError.code !== "42P01") {
      throw new ApiError(400, `Unable to validate the employee profile: ${duplicateProfileError.message}`);
    }
    if (duplicateProfile) throw new ApiError(409, "That email address belongs to another account profile");
  }

  if (target.user_id) {
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(target.user_id, { email, email_confirm: true, user_metadata: { full_name: input.full_name } });
    if (authError) throw new ApiError(400, `Unable to update the sign-in account: ${authError.message}`);
  }
  if (target.user_id) {
    const { error: profileError } = await supabaseAdmin.from("profiles").update({ name: input.full_name, email }).eq("id", target.user_id);
    if (profileError && profileError.code !== "42P01") throw new ApiError(400, `Unable to update the employee profile: ${profileError.message}`);
  }
  const { error: employeeError } = await supabaseAdmin.from("employees").update({ full_name: input.full_name, email, phone: input.phone, role: input.role }).eq("id", employeeId);
  if (employeeError) throw new ApiError(400, `Unable to update the employee record: ${employeeError.message}`);
  if (target.user_id && target.role !== input.role) {
    const { error: removeRoleError } = await supabaseAdmin.from("user_roles").delete().eq("user_id", target.user_id);
    if (removeRoleError) throw new ApiError(400, `Unable to replace the employee role: ${removeRoleError.message}`);
    const { error: addRoleError } = await supabaseAdmin.from("user_roles").insert({ user_id: target.user_id, role: input.role });
    if (addRoleError) throw new ApiError(400, `Unable to assign the employee role: ${addRoleError.message}`);
  }
}

export async function deleteManagedEmployee(input: z.infer<typeof deleteEmployeeInput>, actorEmployeeId: string) {
  if (input.employee_id === actorEmployeeId) throw new ApiError(400, "You cannot delete your own account");
  const { data: target, error: targetError } = await supabaseAdmin
    .from("employees")
    .select("id, user_id, employee_code, full_name, email, role")
    .eq("id", input.employee_id)
    .maybeSingle();
  if (targetError) throw new ApiError(500, targetError.message);
  if (!target) throw new ApiError(404, "Employee not found");

  // Remove the sign-in first. Auth deletion sets employees.user_id to NULL and
  // cascades roles/profile records, while the employee row may still be
  // referenced by historical packages, commissions, and audit rows.
  if (target.user_id) {
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(target.user_id);
    if (authError) throw new ApiError(400, authError.message);
    const { error: roleError } = await supabaseAdmin.from("user_roles").delete().eq("user_id", target.user_id);
    if (roleError) console.warn("[admin/delete-user] role cleanup failed after auth deletion", roleError);
  }

  const { error: deleteError } = await supabaseAdmin.from("employees").delete().eq("id", target.id);
  if (!deleteError) return { employee_id: target.id, employee_code: target.employee_code, archived: false };

  // Older installations have non-cascading foreign keys from operational
  // history to employees. Preserve that history while removing all login
  // access; this is the safe equivalent of deletion for a referenced user.
  if (deleteError.code === "23503" || /foreign key|violates/i.test(deleteError.message)) {
    const { error: archiveError } = await supabaseAdmin.from("employees").update({
      user_id: null,
      is_active: false,
      email: null,
      full_name: `[Deleted] ${target.employee_code}`,
      phone: null,
    }).eq("id", target.id);
    if (archiveError) throw new ApiError(500, archiveError.message);
    return { employee_id: target.id, employee_code: target.employee_code, archived: true };
  }
  throw new ApiError(500, deleteError.message);
}

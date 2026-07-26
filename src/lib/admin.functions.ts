import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  createEmployeeInput,
  createManagedEmployee,
  listManagedEmployees,
  setEmployeeActiveInput,
  setManagedEmployeeActive,
} from "@/lib/admin-api";

async function requireServerFnAdmin(context: { supabase: any; userId: string }) {
  const { data: isAdmin, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!isAdmin) throw new Error("Forbidden: admin only");

  const { data: employee, error: employeeError } = await context.supabase
    .from("employees")
    .select("id, is_active")
    .eq("user_id", context.userId)
    .maybeSingle();
  if (employeeError) throw new Error(employeeError.message);
  if (!employee?.is_active) throw new Error("Forbidden: active administrator required");
  return employee;
}

export const createEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createEmployeeInput.parse(input))
  .handler(async ({ data, context }) => {
    await requireServerFnAdmin(context);
    return { ok: true, employee: await createManagedEmployee(data) };
  });

export const listEmployees = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireServerFnAdmin(context);
    return listManagedEmployees();
  });

export const setEmployeeActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => setEmployeeActiveInput.parse(input))
  .handler(async ({ data, context }) => {
    const actor = await requireServerFnAdmin(context);
    await setManagedEmployeeActive(data, actor.id);
    return { ok: true };
  });

export const deleteEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ employee_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const actor = await requireServerFnAdmin(context);
    const { deleteManagedEmployee } = await import("@/lib/admin-api");
    return { ok: true, archived: await deleteManagedEmployee(data, actor.id) };
  });

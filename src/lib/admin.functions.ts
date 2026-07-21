import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ROLE_PREFIX: Record<string, string> = {
  admin: "ADM",
  sales_manager: "SM",
  logistics_manager: "LM",
  sales_rep: "SR",
};

const createEmployeeSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  full_name: z.string().min(2),
  phone: z.string().optional().nullable(),
  role: z.enum(["admin", "sales_manager", "logistics_manager", "sales_rep"]),
  commission_percentage: z.number().min(0).max(100).optional(),
});

export const createEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createEmployeeSchema.parse(input))
  .handler(async ({ data, context }) => {
    // Authorize: caller must be admin
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin only");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Generate next employee code for role prefix
    const prefix = ROLE_PREFIX[data.role];
    const { data: existing, error: listErr } = await supabaseAdmin
      .from("employees")
      .select("employee_code")
      .like("employee_code", `${prefix}-%`);
    if (listErr) throw new Error(listErr.message);
    let maxN = 0;
    for (const row of existing ?? []) {
      const m = /-(\d+)$/.exec(row.employee_code);
      if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
    }
    const employee_code = `${prefix}-${String(maxN + 1).padStart(4, "0")}`;

    // Create auth user
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (createErr || !created.user) throw new Error(createErr?.message ?? "Failed to create auth user");
    const newUserId = created.user.id;

    // Insert employee row
    const { error: empErr } = await supabaseAdmin.from("employees").insert({
      user_id: newUserId,
      employee_code,
      full_name: data.full_name,
      email: data.email,
      phone: data.phone ?? null,
      role: data.role,
      commission_percentage: data.commission_percentage ?? 0,
      is_active: true,
    });
    if (empErr) {
      await supabaseAdmin.auth.admin.deleteUser(newUserId).catch(() => {});
      throw new Error(empErr.message);
    }

    // Assign app role
    const { error: roleInsErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: newUserId, role: data.role });
    if (roleInsErr) throw new Error(roleInsErr.message);

    return { ok: true, employee_code, user_id: newUserId };
  });

export const listEmployees = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden: admin only");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("employees")
      .select("id, employee_code, full_name, email, phone, role, commission_percentage, is_active, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const setEmployeeActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ employee_id: z.string().uuid(), is_active: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden: admin only");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("employees")
      .update({ is_active: data.is_active })
      .eq("id", data.employee_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
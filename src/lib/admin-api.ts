import { z } from "zod";

export const appRoles = ["admin", "sales_manager", "logistics_manager", "sales_rep", "finance_manager"] as const;
export type AppRole = (typeof appRoles)[number];

export const rolePrefix: Record<AppRole, string> = {
  admin: "ADM",
  sales_manager: "SM",
  logistics_manager: "LM",
  sales_rep: "SR",
  finance_manager: "FIN",
};

export const createEmployeeInput = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Temporary passwords must be at least 8 characters."),
  full_name: z.string().trim().min(2),
  phone: z.string().trim().min(7).max(30).nullable().optional(),
  role: z.enum(appRoles),
  commission_percentage: z.number().min(0).max(100).optional(),
});

export const setEmployeeActiveInput = z.object({
  employee_id: z.string().uuid(),
  is_active: z.boolean(),
});

export const updateEmployeeInput = z.object({
  employee_id: z.string().uuid(),
  full_name: z.string().trim().min(2, "Full name must contain at least 2 characters."),
  email: z.string().trim().email("Enter a valid employee email address."),
  phone: z.string().trim().max(30).nullable().default(null),
  role: z.enum(appRoles),
});

// Profile edits may include is_active from a full employee response. Select
// the action by the edited profile fields, not by incidental response fields.
export function parseEmployeePatch(input: unknown) {
  const profileEdit = input !== null && typeof input === "object" &&
    ["full_name", "email", "role"].some((key) => key in input);
  if (profileEdit) return { action: "profile" as const, data: updateEmployeeInput.parse(input) };
  return { action: "access" as const, data: setEmployeeActiveInput.parse(input) };
}

export const deleteEmployeeInput = z.object({
  employee_id: z.string().uuid(),
});

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

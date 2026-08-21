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

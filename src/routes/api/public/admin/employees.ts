import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ApiError, createEmployeeInput, setEmployeeActiveInput } from "@/lib/admin-api";
import {
  createManagedEmployee,
  listManagedEmployees,
  requireActiveAdmin,
  setManagedEmployeeActive,
  updateManagedEmployee,
} from "@/lib/admin-api.server";

// Mobile-facing admin endpoint. The /api/public prefix bypasses site-level
// auth only; every handler below still requires an active admin's Supabase
// access token via requireActiveAdmin.
function errorResponse(error: unknown) {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
  console.error("[public/admin/employees]", error);
  return Response.json({ error: "Internal server error" }, { status: 500 });
}

export const Route = createFileRoute("/api/public/admin/employees")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await requireActiveAdmin(request);
          return Response.json({ employees: await listManagedEmployees() });
        } catch (error) {
          return errorResponse(error);
        }
      },
      POST: async ({ request }) => {
        try {
          await requireActiveAdmin(request);
          const input = createEmployeeInput.parse(await request.json());
          return Response.json({ employee: await createManagedEmployee(input) }, { status: 201 });
        } catch (error) {
          return errorResponse(error);
        }
      },
      PATCH: async ({ request }) => {
        try {
          const actor = await requireActiveAdmin(request);
          const body = await request.json();
          if (body && typeof body === "object" && "is_active" in body) {
            const input = setEmployeeActiveInput.parse(body);
            await setManagedEmployeeActive(input, actor.employee.id);
          } else {
            const input = z.object({ employee_id: z.string().uuid(), full_name: z.string().trim().min(2), email: z.string().email(), phone: z.string().trim().max(30).nullable(), role: z.enum(["admin", "sales_manager", "logistics_manager", "sales_rep", "finance_manager"]) }).parse(body);
            await updateManagedEmployee(input, actor.employee.id);
          }
          return Response.json({ ok: true });
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
  },
});

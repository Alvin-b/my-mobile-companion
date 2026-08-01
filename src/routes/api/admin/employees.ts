import { createFileRoute } from "@tanstack/react-router";
import { ApiError, createEmployeeInput, setEmployeeActiveInput } from "@/lib/admin-api";
import {
  createManagedEmployee,
  listManagedEmployees,
  requireActiveAdmin,
  setManagedEmployeeActive,
} from "@/lib/admin-api.server";

function errorResponse(error: unknown) {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
  console.error("[admin/employees]", error);
  return Response.json({ error: "Internal server error" }, { status: 500 });
}

export const Route = createFileRoute("/api/admin/employees")({
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
          const input = setEmployeeActiveInput.parse(await request.json());
          await setManagedEmployeeActive(input, actor.employee.id);
          return Response.json({ ok: true });
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
  },
});

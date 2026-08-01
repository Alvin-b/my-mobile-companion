import { createFileRoute } from "@tanstack/react-router";
import { ApiError, deleteEmployeeInput } from "@/lib/admin-api";
import { deleteManagedEmployee, requireActiveAdmin } from "@/lib/admin-api.server";

// Mobile-facing endpoint; admin identity is still verified inside the handler.
export const Route = createFileRoute("/api/public/admin/delete-user")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const actor = await requireActiveAdmin(request);
          const input = deleteEmployeeInput.parse(await request.json());
          return Response.json({ ok: true, deleted: await deleteManagedEmployee(input, actor.employee.id) });
        } catch (error) {
          if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
          console.error("[public/admin/delete-user]", error);
          return Response.json({ error: "Internal server error" }, { status: 500 });
        }
      },
    },
  },
});
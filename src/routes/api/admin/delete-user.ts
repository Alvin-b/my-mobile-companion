import { createFileRoute } from "@tanstack/react-router";
import { ApiError, deleteEmployeeInput, deleteManagedEmployee, requireActiveAdmin } from "@/lib/admin-api";

export const Route = createFileRoute("/api/admin/delete-user")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const actor = await requireActiveAdmin(request);
          const input = deleteEmployeeInput.parse(await request.json());
          return Response.json({ ok: true, archived: await deleteManagedEmployee(input, actor.employee.id) });
        } catch (error) {
          if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
          console.error("[admin/delete-user]", error);
          return Response.json({ error: "Internal server error" }, { status: 500 });
        }
      },
    },
  },
});

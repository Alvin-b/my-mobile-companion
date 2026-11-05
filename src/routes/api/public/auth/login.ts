import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/public/auth/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { email?: string; password?: string };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid login request." }, { status: 400 });
        }
        const email = String(body.email ?? "")
          .trim()
          .toLowerCase();
        const password = String(body.password ?? "");
        if (!email || !password)
          return Response.json({ error: "Email and password are required." }, { status: 400 });
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!url || !key)
          return Response.json(
            { error: "Authentication service is not configured." },
            { status: 503 },
          );
        const client = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error || !data.session || !data.user)
          return Response.json(
            { error: error?.message ?? "Invalid login credentials." },
            { status: 401 },
          );
        return Response.json(
          { session: data.session, user: data.user },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});

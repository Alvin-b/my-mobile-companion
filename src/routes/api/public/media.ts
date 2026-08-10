import { createFileRoute } from "@tanstack/react-router";
import { verifyStaffJwt, signPath } from "@/lib/storage-sign.server";

// Generic signer: turn any stored private storage path into a loadable URL.
// Auth: Supabase JWT of a signed-in staff member.
// GET  /api/public/media?path=proofs/a.jpg[&bucket=proofs][&expires=3600]
// POST /api/public/media   { "paths": ["proofs/a.jpg", "package-photos/b.jpg"] }

const cors = { "cache-control": "no-store" };

export const Route = createFileRoute("/api/public/media")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await verifyStaffJwt(request);
        if (!user) return new Response("Unauthorized", { status: 401 });
        const url = new URL(request.url);
        const path = url.searchParams.get("path");
        if (!path) return new Response("path required", { status: 400 });
        const bucket = url.searchParams.get("bucket") ?? "proofs";
        const expires = Math.min(
          Math.max(Number(url.searchParams.get("expires") ?? 3600) || 3600, 60),
          60 * 60 * 24,
        );
        const signed = await signPath(path, bucket, expires);
        if (!signed) return new Response("Not found", { status: 404 });
        return Response.json({ path, url: signed, expires_in: expires }, { headers: cors });
      },
      POST: async ({ request }) => {
        const user = await verifyStaffJwt(request);
        if (!user) return new Response("Unauthorized", { status: 401 });
        const body = (await request.json().catch(() => null)) as
          | { paths?: string[]; bucket?: string; expires?: number }
          | null;
        const paths = (body?.paths ?? []).filter((p) => typeof p === "string").slice(0, 100);
        if (paths.length === 0) return new Response("paths required", { status: 400 });
        const expires = Math.min(Math.max(Number(body?.expires ?? 3600) || 3600, 60), 86400);
        const urls: Record<string, string | null> = {};
        await Promise.all(
          paths.map(async (p) => {
            urls[p] = await signPath(p, body?.bucket ?? "proofs", expires);
          }),
        );
        return Response.json({ urls, expires_in: expires }, { headers: cors });
      },
    },
  },
});

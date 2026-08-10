// Shared helpers for turning private storage paths into short-lived signed URLs.
export const BUCKETS = [
  "proofs",
  "package-photos",
  "sticker-photos",
  "signatures",
];

export async function verifyStaffJwt(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_PUBLISHABLE_KEY'];
  if (!url || !key) return null;
  const r = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  return (await r.json()) as { id: string; email?: string };
}

export function splitPath(raw: string, fallback = "proofs") {
  // Accepts "proofs/a.jpg", "/proofs/a.jpg", a bare "a.jpg", or a full
  // Supabase storage URL copied from the dashboard.
  let clean = raw.trim();
  const m = clean.match(/\/storage\/v1\/object\/(?:public\/|sign\/)?(.+)$/i);
  if (m && m[1]) clean = m[1].split("?")[0]!;
  clean = clean.replace(/^\/+/, "");
  const first = clean.split("/")[0] ?? "";
  if (BUCKETS.includes(first)) {
    return { bucket: first, path: clean.slice(first.length + 1) };
  }
  return { bucket: fallback, path: clean };
}

export async function signPath(
  raw: string | null | undefined,
  fallbackBucket = "proofs",
  expiresIn = 60 * 60,
): Promise<string | null> {
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw) && !/\/storage\/v1\/object\//i.test(raw)) {
    return raw; // already an external, publicly loadable URL
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { bucket, path } = splitPath(raw, fallbackBucket);
  if (!path) return null;
  const { data } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);
  return data?.signedUrl ?? null;
}

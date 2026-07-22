import { createFileRoute } from "@tanstack/react-router";

// Server-side OCR proxy for shipping labels / airway bills.
// Uses the Lovable AI Gateway so the model key never leaves the server.
// Auth: Supabase JWT (Authorization: Bearer <access_token>) — validated here.
//
// Request:
//   POST /api/public/gemini-ocr
//   Content-Type: application/json
//   Authorization: Bearer <supabase_access_token>
//   { "image_base64": "<jpeg-base64>", "mime_type": "image/jpeg" }
//
// Response 200:
//   { "tracking_number": "...", "consignee_name": "...", ... }

const PROMPT = `You are an OCR extractor for cargo waybills.
Return STRICT JSON only (no markdown, no prose) with these keys, empty string when unknown:
{
  "tracking_number": "",
  "consignee_name": "",
  "consignee_phone": "",
  "origin": "",
  "destination": "",
  "description": "",
  "mode": "",
  "weight": "",
  "pieces": "",
  "cost": ""
}`;

async function verifySupabaseJwt(token: string): Promise<boolean> {
  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return false;
    const r = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
    });
    return r.ok;
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/public/gemini-ocr")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (!token || !(await verifySupabaseJwt(token))) {
          return new Response("Unauthorized", { status: 401 });
        }

        const body = (await request.json().catch(() => null)) as
          | { image_base64?: string; mime_type?: string }
          | null;
        if (!body?.image_base64) {
          return new Response("image_base64 required", { status: 400 });
        }
        const mime = body.mime_type ?? "image/jpeg";

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return new Response("AI not configured", { status: 500 });

        const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: PROMPT },
                  {
                    type: "image_url",
                    image_url: { url: `data:${mime};base64,${body.image_base64}` },
                  },
                ],
              },
            ],
          }),
        });

        if (!resp.ok) {
          const text = await resp.text();
          console.error("[gemini-ocr] gateway error", resp.status, text);
          return new Response(`OCR failed [${resp.status}]: ${text}`, {
            status: resp.status,
          });
        }

        const data = (await resp.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const raw = data.choices?.[0]?.message?.content ?? "";
        const cleaned = raw.replace(/^```json\s*|\s*```$/g, "").trim();
        try {
          return Response.json(JSON.parse(cleaned));
        } catch {
          return Response.json({ raw });
        }
      },
    },
  },
});
// Multi-provider package tracking "agent".
//
// We have no paid tracking API contracts, so the agent walks a chain of
// providers (cheapest / keyless first) and returns the first one that yields
// real checkpoints. Whatever happens, the caller always gets the internal
// DEXCARGO timeline plus deep links to the universal web trackers so an
// employee can finish the lookup by hand.

export type TrackEvent = {
  time: string | null;
  status: string;
  location: string | null;
  source: string;
};

export type ProviderResult = {
  provider: string;
  ok: boolean;
  events: TrackEvent[];
  carrier?: string | null;
  status?: string | null;
  note?: string;
};

const UA =
  "Mozilla/5.0 (compatible; DexcargoTracker/1.0; +https://swift-creation-app.lovable.app)";

async function withTimeout<T>(p: (signal: AbortSignal) => Promise<T>, ms = 8000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await p(ctrl.signal);
  } finally {
    clearTimeout(t);
  }
}

function normTime(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}

/** 1. Cainiao Global — free, keyless, best coverage for China-origin parcels. */
async function cainiao(trackingNumber: string): Promise<ProviderResult> {
  const out: ProviderResult = { provider: "cainiao", ok: false, events: [] };
  try {
    const res = await withTimeout((signal) =>
      fetch(
        `https://global.cainiao.com/global/detail.json?mailNos=${encodeURIComponent(trackingNumber)}&lang=en-US&language=en-US`,
        { headers: { "User-Agent": UA, Accept: "application/json" }, signal },
      ),
    );
    if (!res.ok) return { ...out, note: `HTTP ${res.status}` };
    const json = (await res.json()) as any;
    const module = json?.module?.[0];
    const details: any[] = module?.detailList ?? [];
    out.carrier = module?.latestTrackingInfo?.carrierCode ?? module?.originCountry ?? null;
    out.status = module?.status ?? null;
    out.events = details.map((d) => ({
      time: normTime(d?.time ?? d?.timeStr),
      status: String(d?.desc ?? d?.standerdDesc ?? "").trim(),
      location: d?.group?.name ?? d?.groupName ?? null,
      source: "cainiao",
    }));
    out.ok = out.events.length > 0;
    return out;
  } catch (e) {
    return { ...out, note: e instanceof Error ? e.message : "request failed" };
  }
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

/**
 * 1b. Kuaidi100 (keyless) — China's largest tracking aggregator (1000+
 * carriers incl. EMS, China Post, STO, YTO, SF, Yunda, international legs).
 * Acts like a browsing agent: asks the site to auto-detect the carrier, then
 * queries each candidate until one returns real checkpoints.
 */
async function kuaidi100(trackingNumber: string): Promise<ProviderResult> {
  const out: ProviderResult = { provider: "kuaidi100", ok: false, events: [] };
  const headers = {
    "User-Agent": BROWSER_UA,
    Accept: "application/json",
    Referer: "https://www.kuaidi100.com/",
  };
  try {
    // Step 1: carrier auto-detection (same endpoint their website calls).
    const det = await withTimeout((signal) =>
      fetch(
        `https://www.kuaidi100.com/autonumber/autoComNum?resultv2=1&text=${encodeURIComponent(trackingNumber)}`,
        { headers, signal },
      ),
    );
    if (!det.ok) return { ...out, note: `detect HTTP ${det.status}` };
    const detJson = (await det.json()) as any;
    const candidates: { comCode: string; name: string }[] = [
      ...(detJson?.auto ?? []),
      ...(detJson?.autoDest ?? []),
    ].filter((c: any) => c?.comCode);
    if (!candidates.length) return { ...out, note: "no carrier candidates" };

    // Step 2: try each detected carrier until one yields real checkpoints.
    for (const cand of candidates.slice(0, 5)) {
      const res = await withTimeout((signal) =>
        fetch(
          `https://www.kuaidi100.com/query?type=${encodeURIComponent(cand.comCode)}&postid=${encodeURIComponent(trackingNumber)}`,
          { headers, signal },
        ),
      ).catch(() => null);
      if (!res || !res.ok) continue;
      const json = (await res.json()) as any;
      const rows: any[] = Array.isArray(json?.data) ? json.data : [];
      const events = rows
        .filter((r) => r?.context && !String(r.context).includes("查无结果"))
        .map((r) => ({
          time: normTime(r.time ?? r.ftime),
          status: String(r.context ?? "").trim(),
          location: r.location ?? null,
          source: "kuaidi100",
        }));
      if (events.length > 0) {
        out.carrier = cand.name ?? cand.comCode;
        out.status = json?.state === "3" ? "delivered" : (json?.message ?? null);
        out.events = events;
        out.ok = true;
        return out;
      }
    }
    out.carrier = candidates[0]?.name ?? null;
    out.note = `tried ${Math.min(candidates.length, 5)} carriers, no checkpoints`;
    return out;
  } catch (e) {
    return { ...out, note: e instanceof Error ? e.message : "request failed" };
  }
}

/** 3. 17TRACK official API — only used when a key is configured. */
async function seventeenTrack(trackingNumber: string): Promise<ProviderResult> {
  const out: ProviderResult = { provider: "17track", ok: false, events: [] };
  const key = process.env["SEVENTEEN_TRACK_API_KEY"];
  if (!key) return { ...out, note: "no api key configured" };
  try {
    const body = JSON.stringify([{ number: trackingNumber }]);
    const headers = { "17token": key, "Content-Type": "application/json", "User-Agent": UA };
    // Register first (idempotent), then read.
    await withTimeout((signal) =>
      fetch("https://api.17track.net/track/v2.2/register", { method: "POST", headers, body, signal }),
    ).catch(() => undefined);
    const res = await withTimeout((signal) =>
      fetch("https://api.17track.net/track/v2.2/gettrackinfo", { method: "POST", headers, body, signal }),
    );
    if (!res.ok) return { ...out, note: `HTTP ${res.status}` };
    const json = (await res.json()) as any;
    const item = json?.data?.accepted?.[0];
    const info = item?.track_info;
    const events: any[] = info?.tracking?.providers?.[0]?.events ?? [];
    out.carrier = info?.tracking?.providers?.[0]?.provider?.name ?? null;
    out.status = info?.latest_status?.status ?? null;
    out.events = events.map((e) => ({
      time: normTime(e?.time_iso ?? e?.time_utc),
      status: String(e?.description ?? "").trim(),
      location: e?.location ?? null,
      source: "17track",
    }));
    out.ok = out.events.length > 0;
    return out;
  } catch (e) {
    return { ...out, note: e instanceof Error ? e.message : "request failed" };
  }
}

/** 3. ParcelsApp API — only used when a key is configured. */
async function parcelsApp(trackingNumber: string): Promise<ProviderResult> {
  const out: ProviderResult = { provider: "parcelsapp", ok: false, events: [] };
  const key = process.env["PARCELSAPP_API_KEY"];
  if (!key) return { ...out, note: "no api key configured" };
  try {
    const res = await withTimeout((signal) =>
      fetch("https://parcelsapp.com/api/v3/shipments/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA },
        body: JSON.stringify({ apiKey: key, language: "en", shipments: [{ trackingId: trackingNumber }] }),
        signal,
      }),
    );
    if (!res.ok) return { ...out, note: `HTTP ${res.status}` };
    const json = (await res.json()) as any;
    const sh = json?.shipments?.[0];
    const states: any[] = sh?.states ?? [];
    out.carrier = sh?.detectedCarrier?.name ?? null;
    out.status = sh?.status ?? null;
    out.events = states.map((s) => ({
      time: normTime(s?.date),
      status: String(s?.status ?? "").trim(),
      location: s?.location ?? null,
      source: "parcelsapp",
    }));
    out.ok = out.events.length > 0;
    if (!out.ok && json?.uuid) out.note = "queued by parcelsapp, retry shortly";
    return out;
  } catch (e) {
    return { ...out, note: e instanceof Error ? e.message : "request failed" };
  }
}

/** 4. Ship24 public tracking JSON (keyless best-effort mirror). */
async function trackingMore(trackingNumber: string): Promise<ProviderResult> {
  const out: ProviderResult = { provider: "trackingmore", ok: false, events: [] };
  const key = process.env["TRACKINGMORE_API_KEY"];
  if (!key) return { ...out, note: "no api key configured" };
  try {
    const res = await withTimeout((signal) =>
      fetch(`https://api.trackingmore.com/v4/trackings/get?tracking_numbers=${encodeURIComponent(trackingNumber)}`, {
        headers: { "Tracking-Api-Key": key, "Content-Type": "application/json" },
        signal,
      }),
    );
    if (!res.ok) return { ...out, note: `HTTP ${res.status}` };
    const json = (await res.json()) as any;
    const item = json?.data?.[0];
    const events: any[] = item?.origin_info?.trackinfo ?? [];
    out.carrier = item?.courier_code ?? null;
    out.status = item?.delivery_status ?? null;
    out.events = events.map((e) => ({
      time: normTime(e?.checkpoint_date),
      status: String(e?.tracking_detail ?? "").trim(),
      location: e?.location ?? null,
      source: "trackingmore",
    }));
    out.ok = out.events.length > 0;
    return out;
  } catch (e) {
    return { ...out, note: e instanceof Error ? e.message : "request failed" };
  }
}

// NOTE: 4PX, YunExpress and Ship24 have retired or bot-locked their public
// tracking APIs (verified 2026-09), so they are not queried — they remain in
// webTrackerLinks() below for manual one-click lookup. Adding a 17TRACK,
// ParcelsApp or TrackingMore API key automatically activates that provider.
export const PROVIDER_CHAIN = [cainiao, seventeenTrack, parcelsApp, trackingMore];

export function webTrackerLinks(trackingNumber: string) {
  const n = encodeURIComponent(trackingNumber);
  return {
    "17track": `https://t.17track.net/en#nums=${n}`,
    parcelsapp: `https://parcelsapp.com/en/tracking/${n}`,
    cainiao: `https://global.cainiao.com/detail.htm?mailNoList=${n}&lang=en`,
    trackingmore: `https://www.trackingmore.com/track/en/${n}`,
    ship24: `https://www.ship24.com/tracking?p=${n}`,
    "4px": `https://track.4px.com/#/result/0/${n}`,
  };
}

/**
 * Queries EVERY provider at the same time and returns the richest response.
 * Fan-out keeps the lookup as fast as the slowest single provider (~8s cap)
 * instead of the sum of all of them, and one carrier missing the parcel no
 * longer blocks the others.
 */
export async function runTrackingAgent(trackingNumber: string) {
  const attempts = await Promise.all(
    PROVIDER_CHAIN.map((provider) =>
      provider(trackingNumber).catch(
        (e): ProviderResult => ({
          provider: provider.name,
          ok: false,
          events: [],
          note: e instanceof Error ? e.message : "request failed",
        }),
      ),
    ),
  );

  const hits = attempts.filter((a) => a.ok);
  // Prefer the provider with the most checkpoints (richest history).
  hits.sort((a, b) => b.events.length - a.events.length);
  const winner = hits[0] ?? null;

  return { winner, attempts, hits };
}


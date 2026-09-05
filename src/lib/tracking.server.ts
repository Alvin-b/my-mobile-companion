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
    const detected: { comCode: string; name: string }[] = [
      ...(detJson?.auto ?? []),
      ...(detJson?.autoDest ?? []),
    ].filter((c: any) => c?.comCode);

    // Always append the carriers that actually move China -> Kenya freight, so
    // a failed auto-detection never means "not found".
    const FALLBACK = [
      "emsguoji",
      "youzhengguonei",
      "ems",
      "yunexpress",
      "sfguoji",
      "yanwen",
      "4px",
      "jtexpress",
      "cainiao",
      "shunfeng",
      "yuantong",
      "zhongtong",
      "shentong",
      "yunda",
    ];
    const seen = new Set<string>();
    const candidates = [
      ...detected,
      ...FALLBACK.map((c) => ({ comCode: c, name: c })),
    ].filter((c) => (seen.has(c.comCode) ? false : (seen.add(c.comCode), true)));

    // Step 2: try each carrier until one yields real checkpoints.
    for (const cand of candidates.slice(0, 12)) {
      const res = await withTimeout((signal) =>
        fetch(
          `https://www.kuaidi100.com/query?type=${encodeURIComponent(cand.comCode)}&postid=${encodeURIComponent(trackingNumber)}&temp=${Math.random()}&phone=`,
          { headers, signal },
        ),
      ).catch(() => null);
      if (!res || !res.ok) continue;
      const json = (await res.json().catch(() => null)) as any;
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
    out.note = `tried ${Math.min(candidates.length, 12)} carriers, no checkpoints`;
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

/** 5. Cainiao Guoguo mirror — second Cainiao datacentre, different coverage. */
async function cainiaoGuoguo(trackingNumber: string): Promise<ProviderResult> {
  const out: ProviderResult = { provider: "cainiao-guoguo", ok: false, events: [] };
  try {
    const res = await withTimeout((signal) =>
      fetch(
        `https://global.cainiao.com/global/detail.json?mailNoList=${encodeURIComponent(trackingNumber)}&lang=en-US`,
        { headers: { "User-Agent": BROWSER_UA, Accept: "application/json" }, signal },
      ),
    );
    if (!res.ok) return { ...out, note: `HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as any;
    const mod = json?.module?.[0];
    const details: any[] = mod?.detailList ?? [];
    out.carrier = mod?.latestTrackingInfo?.carrierCode ?? null;
    out.status = mod?.status ?? null;
    out.events = details.map((d) => ({
      time: normTime(d?.time ?? d?.timeStr),
      status: String(d?.desc ?? d?.standerdDesc ?? "").trim(),
      location: d?.group?.name ?? null,
      source: "cainiao-guoguo",
    }));
    out.ok = out.events.length > 0;
    return out;
  } catch (e) {
    return { ...out, note: e instanceof Error ? e.message : "request failed" };
  }
}

/** 6. Ship24 API — activates automatically when SHIP24_API_KEY is set. */
async function ship24(trackingNumber: string): Promise<ProviderResult> {
  const out: ProviderResult = { provider: "ship24", ok: false, events: [] };
  const key = process.env["SHIP24_API_KEY"];
  if (!key) return { ...out, note: "no api key configured" };
  try {
    const res = await withTimeout((signal) =>
      fetch("https://api.ship24.com/public/v1/tracking/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ trackingNumber }),
        signal,
      }),
    );
    if (!res.ok) return { ...out, note: `HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as any;
    const tr = json?.data?.trackings?.[0];
    const events: any[] = tr?.events ?? [];
    out.carrier = tr?.shipment?.recipient?.name ?? events[0]?.courierCode ?? null;
    out.status = tr?.shipment?.statusMilestone ?? null;
    out.events = events.map((e) => ({
      time: normTime(e?.occurrenceDatetime ?? e?.datetime),
      status: String(e?.status ?? "").trim(),
      location: e?.location ?? null,
      source: "ship24",
    }));
    out.ok = out.events.length > 0;
    return out;
  } catch (e) {
    return { ...out, note: e instanceof Error ? e.message : "request failed" };
  }
}

/** 7. AfterShip API — activates automatically when AFTERSHIP_API_KEY is set. */
async function afterShip(trackingNumber: string): Promise<ProviderResult> {
  const out: ProviderResult = { provider: "aftership", ok: false, events: [] };
  const key = process.env["AFTERSHIP_API_KEY"];
  if (!key) return { ...out, note: "no api key configured" };
  try {
    const res = await withTimeout((signal) =>
      fetch(
        `https://api.aftership.com/tracking/2024-04/trackings?tracking_numbers=${encodeURIComponent(trackingNumber)}`,
        { headers: { "as-api-key": key, "Content-Type": "application/json" }, signal },
      ),
    );
    if (!res.ok) return { ...out, note: `HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as any;
    const t = json?.data?.trackings?.[0];
    const events: any[] = t?.checkpoints ?? [];
    out.carrier = t?.slug ?? null;
    out.status = t?.tag ?? null;
    out.events = events.map((e) => ({
      time: normTime(e?.checkpoint_time ?? e?.created_at),
      status: String(e?.message ?? e?.tag ?? "").trim(),
      location: e?.location ?? e?.city ?? null,
      source: "aftership",
    }));
    out.ok = out.events.length > 0;
    return out;
  } catch (e) {
    return { ...out, note: e instanceof Error ? e.message : "request failed" };
  }
}

/** 8. Track123 API — activates automatically when TRACK123_API_KEY is set. */
async function track123(trackingNumber: string): Promise<ProviderResult> {
  const out: ProviderResult = { provider: "track123", ok: false, events: [] };
  const key = process.env["TRACK123_API_KEY"];
  if (!key) return { ...out, note: "no api key configured" };
  try {
    const res = await withTimeout((signal) =>
      fetch("https://api.track123.com/gateway/open-api/tk/v2/track/query", {
        method: "POST",
        headers: { "Track123-Api-Secret": key, "Content-Type": "application/json" },
        body: JSON.stringify({ trackNos: [trackingNumber] }),
        signal,
      }),
    );
    if (!res.ok) return { ...out, note: `HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as any;
    const item = json?.data?.content?.[0] ?? json?.data?.accepted?.[0];
    const providers: any[] = item?.localLogisticsInfo?.trackingDetails ?? [];
    const globalEv: any[] = item?.localProviderList?.[0]?.trackingDetails ?? [];
    const rows = providers.length ? providers : globalEv;
    out.carrier = item?.courierCode ?? null;
    out.status = item?.trackStatus ?? null;
    out.events = rows.map((e) => ({
      time: normTime(e?.eventTime ?? e?.time),
      status: String(e?.eventDetail ?? e?.status ?? "").trim(),
      location: e?.address ?? null,
      source: "track123",
    }));
    out.ok = out.events.length > 0;
    return out;
  } catch (e) {
    return { ...out, note: e instanceof Error ? e.message : "request failed" };
  }
}

// Keyless providers run always; keyed ones self-activate the moment their API
// key exists in the environment. 4PX, YunExpress and Track718 have retired or
// bot-locked their public APIs (verified 2026-09) so they stay as manual links.
export const PROVIDER_CHAIN = [
  cainiao,
  cainiaoGuoguo,
  kuaidi100,
  seventeenTrack,
  parcelsApp,
  trackingMore,
  ship24,
  afterShip,
  track123,
];

export function webTrackerLinks(trackingNumber: string) {
  const n = encodeURIComponent(trackingNumber);
  return {
    "17track": `https://t.17track.net/en#nums=${n}`,
    parcelsapp: `https://parcelsapp.com/en/tracking/${n}`,
    cainiao: `https://global.cainiao.com/detail.htm?mailNoList=${n}&lang=en`,
    trackingmore: `https://www.trackingmore.com/track/en/${n}`,
    ship24: `https://www.ship24.com/tracking?p=${n}`,
    "4px": `https://track.4px.com/#/result/0/${n}`,
    aftership: `https://www.aftership.com/track/${n}`,
    track123: `https://www.track123.com/en/${n}`,
    kuaidi100: `https://www.kuaidi100.com/chaxun?nu=${n}`,
    yunexpress: `https://www.yuntrack.com/parcelTracking?id=${n}`,
    postakenya: `https://www.posta.co.ke/track-trace?tracking=${n}`,
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


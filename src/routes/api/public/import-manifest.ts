import { createFileRoute } from "@tanstack/react-router";
import { inflateRawSync } from "node:zlib";
import { verifyStaffJwt } from "@/lib/storage-sign.server";

type Category = "general" | "special" | "sea";
type Parsed = { row_number: number; id: string; tracking_number: string; consignee: string; pcs: number | null; weight: number | null; volume_cbm: number | null; cost: number | null; description: string | null; issue?: string };
const clean = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown) => { const n = Number(String(value ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : null; };

function column(row: unknown[], names: string[]) { return row.findIndex((cell) => names.some((name) => clean(cell).replace(/\s+/g, "").toLowerCase() === name.replace(/\s+/g, "").toLowerCase())); }
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
function xlsxRows(source: ArrayBuffer): unknown[][] {
  const bytes = Buffer.from(source), end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])); if (end < 0) throw new Error("This is not a valid .xlsx workbook.");
  let at = bytes.readUInt32LE(end + 16); const count = bytes.readUInt16LE(end + 10), entries = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) { const method = bytes.readUInt16LE(at + 10), size = bytes.readUInt32LE(at + 20), n = bytes.readUInt16LE(at + 28), e = bytes.readUInt16LE(at + 30), c = bytes.readUInt16LE(at + 32), local = bytes.readUInt32LE(at + 42), name = bytes.subarray(at + 46, at + 46 + n).toString(); const ln = bytes.readUInt16LE(local + 26), le = bytes.readUInt16LE(local + 28), data = bytes.subarray(local + 30 + ln + le, local + 30 + ln + le + size); entries.set(name, method === 8 ? inflateRawSync(data) : data); at += 46 + n + e + c; }
  const ss = entries.get("xl/sharedStrings.xml")?.toString() ?? "", strings = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(""))), sheet = entries.get("xl/worksheets/sheet1.xml")?.toString(); if (!sheet) throw new Error("The first worksheet could not be read."); const rows: unknown[][] = [];
  for (const match of sheet.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) { const row: unknown[] = []; for (const cell of match[2].matchAll(/<c[^>]*r="([A-Z]+)\d+"(?:[^>]*t="([^"]+)")?[^>]*>([\s\S]*?)<\/c>/g)) { let col = 0; for (const ch of cell[1]) col = col * 26 + ch.charCodeAt(0) - 64; const raw = /<v>([\s\S]*?)<\/v>/.exec(cell[3])?.[1] ?? "", inline = /<t[^>]*>([\s\S]*?)<\/t>/.exec(cell[3])?.[1]; row[col - 1] = cell[2] === "s" ? strings[Number(raw)] ?? "" : inline != null ? decode(inline) : decode(raw); } rows[Number(match[1]) - 1] = row; }
  return rows;
}
function parseSheet(file: ArrayBuffer, category: Category): Parsed[] {
  const rows = xlsxRows(file);
  const sea = category === "sea";
  const headerIndex = rows.findIndex((row) => sea ? column(row, ["入仓单号"]) >= 0 : column(row, ["ExpressNo"]) >= 0);
  if (headerIndex < 0) throw new Error(sea ? "Sea manifest header '入仓单号' was not found." : "Air manifest header 'ExpressNo' was not found.");
  const header = rows[headerIndex];
  const tracking = column(header, sea ? ["入仓单号"] : ["ExpressNo"]);
  const customer = column(header, sea ? ["客户名"] : ["Contact"]);
  const pcs = column(header, sea ? ["件数"] : ["PCS"]);
  const weight = column(header, sea ? ["重量"] : ["Chargeable Weight"]);
  const cbm = sea ? column(header, ["体积"]) : -1;
  const description = sea ? column(header, ["入库品名"]) : -1;
  const kes = sea ? column(header, ["账单"]) : column(header, ["Total price KES"]);
  const output: Parsed[] = [];
  rows.slice(headerIndex + 1).forEach((row, offset) => {
    const track = clean(row[tracking]);
    if (!track) return;
    const rowNumber = headerIndex + offset + 2;
    const costValue = clean(row[kes]);
    const cost = sea ? number((costValue.match(/([\d,.]+)\s*KES/i) || [])[1]) : number(row[kes]);
    output.push({ row_number: rowNumber, id: sea ? `${track}-S${rowNumber}` : track, tracking_number: track, consignee: clean(row[customer]) || "Unassigned client", pcs: number(row[pcs]), weight: number(row[weight]), volume_cbm: cbm >= 0 ? number(row[cbm]) : null, cost, description: description >= 0 ? clean(row[description]) || null : `${category === "special" ? "Special" : "General"} air cargo`, issue: clean(row[customer]) ? undefined : "Client name is missing" });
  });
  if (!output.length) throw new Error("No manifest package rows were found.");
  return output;
}

export const Route = createFileRoute("/api/public/import-manifest")({ server: { handlers: { POST: async ({ request }) => {
  const user = await verifyStaffJwt(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: employee } = await supabaseAdmin.from("employees").select("role,is_active").eq("user_id", user.id).maybeSingle();
  if (!employee?.is_active || !["admin", "sales_manager", "sm"].includes(employee.role)) return Response.json({ error: "Active Sales Manager or administrator access is required" }, { status: 403 });
  const form = await request.formData(); const category = clean(form.get("category")) as Category; const upload = form.get("file"); const commit = clean(form.get("commit")) === "true";
  if (!["general", "special", "sea"].includes(category)) return Response.json({ error: "Choose General, Special, or Sea cargo." }, { status: 400 });
  if (!(upload instanceof File) || !upload.name.toLowerCase().endsWith(".xlsx")) return Response.json({ error: "Upload an Excel .xlsx manifest." }, { status: 400 });
  if (upload.size > 10 * 1024 * 1024) return Response.json({ error: "Manifest must be 10 MB or smaller." }, { status: 400 });
  let parsed: Parsed[]; try { parsed = parseSheet(await upload.arrayBuffer(), category); } catch (e: any) { return Response.json({ error: e?.message ?? "Manifest could not be read" }, { status: 400 }); }
  const keys = [...new Set(parsed.map((p) => p.id))];
  const { data: existing } = await supabaseAdmin.from("cargo_packages").select("id,tracking_number").in("id", keys);
  const exists = new Set((existing ?? []).map((p) => p.id)); const duplicateInFile = new Set<string>(); const seen = new Set<string>();
  parsed.forEach((p) => { if (seen.has(p.id)) duplicateInFile.add(p.id); seen.add(p.id); });
  const ready = parsed.filter((p) => !p.issue && !exists.has(p.id) && !duplicateInFile.has(p.id));
  const invalid = parsed.filter((p) => p.issue || duplicateInFile.has(p.id)); const duplicates = parsed.filter((p) => exists.has(p.id));
  const preview = { category, total_rows: parsed.length, ready_rows: ready.length, duplicate_rows: duplicates.length, invalid_rows: invalid.length, ready: ready.slice(0, 200), duplicates: duplicates.slice(0, 200), invalid: invalid.slice(0, 200) };
  if (!commit) return Response.json(preview, { headers: { "cache-control": "no-store" } });
  const manifestId = `${category.toUpperCase()}-${Date.now()}`;
  const payload = ready.map((p) => ({ ...p, issue: undefined, mode: category === "sea" ? "sea" : "air", cargo_category: category, origin: category === "sea" ? "China" : "Guangzhou", dest: "Nairobi", status: "registered", manifest_id: manifestId, manifest_name: upload.name, imported_by: user.id, imported_at: new Date().toISOString(), created_by: user.id }));
  const { error: insertError } = payload.length ? await supabaseAdmin.from("cargo_packages").insert(payload) : { error: null };
  if (insertError) return Response.json({ error: insertError.message, ...preview }, { status: 400 });
  await supabaseAdmin.from("manifest_imports").insert({ id: manifestId, category, source_file_name: upload.name, total_rows: parsed.length, imported_rows: payload.length, duplicate_rows: duplicates.length, invalid_rows: invalid.length, imported_by: user.id, notes: { header_format: category === "sea" ? "sea_chinese" : "air" } });
  return Response.json({ ok: true, manifest_id: manifestId, imported_rows: payload.length, ...preview });
} } } });

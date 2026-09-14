import { createFileRoute } from "@tanstack/react-router";
import { inflateRawSync } from "node:zlib";
import { verifyStaffJwt } from "@/lib/storage-sign.server";

type Category = "general" | "special" | "sea";
type Parsed = {
  row_number: number; id: string; tracking_number: string; consignee: string;
  pcs: number | null; weight: number | null; volume_cbm: number | null; cost: number | null;
  description: string | null; unit_price_usd: number | null; total_price_rmb: number | null;
  total_price_usd: number | null; total_price_kes: number | null; payment_mode: string | null;
  manifest_line_date: string | null; manifest_signature: string | null;
  warehouse_received_date: string | null; warehouse_receipt_number: string | null;
  container_position: string | null; billing_formula: string | null;
  billing_amount: number | null; billing_currency: string | null; billing_rate: number | null; billing_total_cbm: number | null;
  manifest_data: Record<string, unknown>; issue?: string;
};
const clean = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown) => { const raw = String(value ?? "").replace(/,/g, "").trim(); if (!raw) return null; const n = Number(raw); return Number.isFinite(n) ? n : null; };

const headerKey = (value: unknown) => clean(value).normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
function column(row: unknown[], names: string[]) { return row.findIndex((cell) => names.some((name) => headerKey(cell) === headerKey(name))); }
function flexibleColumn(row: unknown[], names: string[]) {
  const exact = column(row, names); if (exact >= 0) return exact;
  return row.findIndex((cell) => { const value = headerKey(cell); return names.some((name) => value.includes(headerKey(name))); });
}
function cellAddress(address: string) {
  const match = /^([A-Z]+)(\d+)$/i.exec(address); if (!match) return null;
  let columnNumber = 0; for (const character of match[1].toUpperCase()) columnNumber = columnNumber * 26 + character.charCodeAt(0) - 64;
  return { row: Number(match[2]) - 1, column: columnNumber - 1 };
}
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
function xlsxRows(source: ArrayBuffer): unknown[][] {
  const bytes = Buffer.from(source), end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])); if (end < 0) throw new Error("This is not a valid .xlsx workbook.");
  let at = bytes.readUInt32LE(end + 16); const count = bytes.readUInt16LE(end + 10), entries = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) { const method = bytes.readUInt16LE(at + 10), size = bytes.readUInt32LE(at + 20), n = bytes.readUInt16LE(at + 28), e = bytes.readUInt16LE(at + 30), c = bytes.readUInt16LE(at + 32), local = bytes.readUInt32LE(at + 42), name = bytes.subarray(at + 46, at + 46 + n).toString(); const ln = bytes.readUInt16LE(local + 26), le = bytes.readUInt16LE(local + 28), data = bytes.subarray(local + 30 + ln + le, local + 30 + ln + le + size); entries.set(name, method === 8 ? inflateRawSync(data) : data); at += 46 + n + e + c; }
  const ss = entries.get("xl/sharedStrings.xml")?.toString() ?? "", strings = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(""))), sheet = entries.get("xl/worksheets/sheet1.xml")?.toString(); if (!sheet) throw new Error("The first worksheet could not be read."); const rows: unknown[][] = [];
  for (const match of sheet.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) { const row: unknown[] = []; for (const cell of match[2].matchAll(/<c[^>]*r="([A-Z]+)\d+"(?:[^>]*t="([^"]+)")?[^>]*>([\s\S]*?)<\/c>/g)) { let col = 0; for (const ch of cell[1]) col = col * 26 + ch.charCodeAt(0) - 64; const raw = /<v>([\s\S]*?)<\/v>/.exec(cell[3])?.[1] ?? "", inline = /<t[^>]*>([\s\S]*?)<\/t>/.exec(cell[3])?.[1], formula = /<f[^>]*>([\s\S]*?)<\/f>/.exec(cell[3])?.[1]; row[col - 1] = cell[2] === "s" ? strings[Number(raw)] ?? "" : inline != null ? decode(inline) : decode(formula || raw || ""); } rows[Number(match[1]) - 1] = row; }
  // Sea manifests use vertically merged client and billing cells. Excel keeps
  // the authoritative owner/charge in the top-left cell. Some exports retain
  // hidden values under a merge, which must not replace the visible parent.
  for (const merged of sheet.matchAll(/<mergeCell\s+ref="([A-Z]+\d+):([A-Z]+\d+)"\s*\/>/g)) {
    const start = cellAddress(merged[1]), endAddress = cellAddress(merged[2]); if (!start || !endAddress) continue;
    const value = rows[start.row]?.[start.column]; if (value == null || value === "") continue;
    for (let rowNumber = start.row; rowNumber <= endAddress.row; rowNumber++) {
      rows[rowNumber] ??= [];
      for (let columnNumber = start.column; columnNumber <= endAddress.column; columnNumber++) rows[rowNumber][columnNumber] = value;
    }
  }
  return rows;
}
function total(rows: Parsed[], field: "pcs" | "weight" | "volume_cbm") { const values = rows.map((row) => row[field]).filter((value): value is number => value != null); return values.length ? values.reduce((sum, value) => sum + value, 0) : null; }
function usableClientName(value: string) { return Boolean(value && value !== "Unassigned client" && !/^\d+$/.test(value)); }
function consolidateSeaRows(rows: Parsed[]) {
  const groups: Parsed[][] = [];
  for (const row of rows) {
    const previous = groups[groups.length - 1]; const parent = previous?.[0];
    // The merged 客户名 + 账单 cells define a payable client package. This is
    // intentionally not just a matching tracking number: a parent can contain
    // several tracking/warehouse receipt lines under one client and one bill.
    if (parent?.consignee === row.consignee && parent.billing_formula && parent.billing_formula === row.billing_formula) previous.push(row); else groups.push([row]);
  }
  return groups.map((group) => {
    if (group.length === 1) return group[0];
    const first = group[0];
    const packageOwner = group.find((row) => usableClientName(row.consignee))?.consignee ?? first.consignee;
    const groupBill = group.find((row) => row.billing_amount != null || row.billing_formula)?.billing_formula ?? null;
    const groupBillAmount = group.find((row) => row.billing_amount != null)?.billing_amount ?? null;
    const groupBillCurrency = group.find((row) => row.billing_currency)?.billing_currency ?? null;
    const groupBillRate = group.find((row) => row.billing_rate != null)?.billing_rate ?? null;
    const groupTotalCbm = group.find((row) => row.billing_total_cbm != null)?.billing_total_cbm ?? total(group, "volume_cbm");
    const lineItems = group.map((row) => ({ row_number: row.row_number, warehouse_receipt_number: row.warehouse_receipt_number, client_name_on_line: row.consignee, pcs: row.pcs, weight: row.weight, volume_cbm: row.volume_cbm, description: row.description, container_position: row.container_position, columns: row.manifest_data.columns }));
    return {
      ...first,
      consignee: packageOwner,
      pcs: total(group, "pcs"), weight: total(group, "weight"), volume_cbm: groupTotalCbm,
      description: [...new Set(group.map((row) => row.description).filter(Boolean))].join(" · ") || null,
      cost: groupBillCurrency === "KES" ? groupBillAmount : null,
      billing_formula: groupBill, billing_amount: groupBillAmount, billing_currency: groupBillCurrency, billing_rate: groupBillRate,
      manifest_data: { ...first.manifest_data, group: { line_count: group.length, parent_tracking_number: first.tracking_number, receipt_numbers: group.map((row) => row.tracking_number), package_owner: packageOwner, billing_is_group_total: true }, line_items: lineItems, billing: { raw: groupBill, amount: groupBillAmount, currency: groupBillCurrency, rate: groupBillRate, total_cbm: groupTotalCbm } }
    };
  });
}
function parseSheet(file: ArrayBuffer, category: Category): Parsed[] {
  const rows = xlsxRows(file);
  const sea = category === "sea";
  const headerIndex = rows.findIndex((row) => sea ? column(row, ["入仓单号"]) >= 0 : column(row, ["ExpressNo"]) >= 0);
  if (headerIndex < 0) throw new Error(sea ? "Sea manifest header '入仓单号' was not found." : "Air manifest header 'ExpressNo' was not found.");
  const header = rows[headerIndex];
  const metadata: Record<string, unknown> = {};
  rows.slice(0, headerIndex).forEach((row) => { if (row?.[0] != null && row?.[1] != null) metadata[clean(row[0])] = row[1]; });
  const tracking = column(header, sea ? ["入仓单号"] : ["ExpressNo"]);
  const customer = column(header, sea ? ["客户名"] : ["Contact"]);
  const pcs = column(header, sea ? ["件数"] : ["PCS"]);
  const weight = column(header, sea ? ["重量"] : ["Chargeable Weight"]);
  const cbm = sea ? column(header, ["体积"]) : -1;
  const description = sea ? column(header, ["入库品名"]) : -1;
  const receivedDate = sea ? column(header, ["入仓日期"]) : -1;
  const containerPosition = sea ? column(header, ["装柜位置"]) : -1;
  const unitUsd = sea ? -1 : column(header, ["Unit Price USD"]);
  const totalRmb = sea ? -1 : column(header, ["Total price RMB"]);
  const totalUsd = sea ? -1 : column(header, ["Total price USD"]);
  const totalKes = sea ? -1 : column(header, ["Total price KES"]);
  const paymentMode = sea ? -1 : column(header, ["Payment mode"]);
  const lineDate = sea ? -1 : column(header, ["DATE"]);
  const signature = sea ? -1 : column(header, ["Signature"]);
  const billing = sea ? flexibleColumn(header, ["账单", "账单金额", "费用", "应收", "结算金额", "Bill", "Billing"]) : -1;
  const output: Parsed[] = [];
  rows.slice(headerIndex + 1).forEach((row, offset) => {
    const track = clean(row[tracking]);
    if (!track) return;
    const rowNumber = headerIndex + offset + 2;
    const costValue = sea ? clean(row[billing]) : "";
    const billMatch = costValue.match(/=\s*([\d,.]+)\s*(KES|RMB|USD|CNY|元|人民币)?/i) || costValue.match(/([\d,.]+)\s*(KES|RMB|USD|CNY|元|人民币)/i);
    const rateMatch = costValue.match(/([\d,.]+)\s*[x×*]\s*([\d,.]+)/i);
    // Some Excel exports save only a formula such as 0.11*3800. Safely derive
    // the result without evaluating arbitrary formula text.
    const calculatedAmount = rateMatch ? number(rateMatch[1])! * number(rateMatch[2])! : null;
    const billingAmount = number(billMatch?.[1]) ?? calculatedAmount;
    const rawCurrency = billMatch?.[2]?.toUpperCase() ?? null;
    const billingCurrency = rawCurrency === "CNY" || rawCurrency === "元" || rawCurrency === "人民币" ? "RMB" : rawCurrency;
    const billingRate = number(rateMatch?.[2]);
    const billingTotalCbm = number(rateMatch?.[1]);
    const kesAmount = totalKes >= 0 ? number(row[totalKes]) : null;
    // cargo_packages.cost is company KES revenue. Never store RMB/USD as KES.
    const cost = sea ? (billingCurrency === "KES" ? billingAmount : null) : kesAmount;
    const columns: Record<string, unknown> = {};
    header.forEach((name, index) => { const key = clean(name); if (key) columns[key] = row[index] ?? null; });
    output.push({
      row_number: rowNumber, id: sea ? `${track}-S${rowNumber}` : track,
      tracking_number: track, consignee: clean(row[customer]) || "Unassigned client",
      pcs: number(row[pcs]), weight: number(row[weight]), volume_cbm: cbm >= 0 ? number(row[cbm]) : null,
      cost, description: description >= 0 ? clean(row[description]) || null : `${category === "special" ? "Special" : "General"} air cargo`,
      unit_price_usd: unitUsd >= 0 ? number(row[unitUsd]) : null,
      total_price_rmb: totalRmb >= 0 ? number(row[totalRmb]) : null,
      total_price_usd: totalUsd >= 0 ? number(row[totalUsd]) : null,
      total_price_kes: kesAmount,
      payment_mode: paymentMode >= 0 ? clean(row[paymentMode]) || null : null,
      manifest_line_date: lineDate >= 0 ? clean(row[lineDate]) || null : null,
      manifest_signature: signature >= 0 ? clean(row[signature]) || null : null,
      warehouse_received_date: receivedDate >= 0 ? clean(row[receivedDate]) || null : null,
      warehouse_receipt_number: sea ? track : null,
      container_position: containerPosition >= 0 ? clean(row[containerPosition]) || null : null,
      billing_formula: sea ? costValue || null : null,
      billing_amount: sea ? billingAmount : null, billing_currency: sea ? billingCurrency : null, billing_rate: sea ? billingRate : null, billing_total_cbm: sea ? billingTotalCbm : null,
      manifest_data: { category, source_row: rowNumber, metadata, columns, billing: { raw: costValue, amount: billingAmount, currency: billingCurrency, rate: billingRate, total_cbm: billingTotalCbm } },
      issue: clean(row[customer]) ? undefined : "Client name is missing"
    });
  });
  const parsed = sea ? consolidateSeaRows(output) : output;
  if (!parsed.length) throw new Error("No manifest package rows were found.");
  return parsed;
}

export const Route = createFileRoute("/api/public/import-manifest")({ server: { handlers: { POST: async ({ request }) => {
  const user = await verifyStaffJwt(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: employee } = await supabaseAdmin.from("employees").select("role,is_active").eq("user_id", user.id).maybeSingle();
  if (!employee?.is_active) return Response.json({ error: "An active DEX employee account is required" }, { status: 403 });
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
  // Map only columns that actually belong to cargo_packages. Preview-only fields
  // such as row_number and issue must never be sent to Supabase.
  const payload = ready.map((p) => ({
    id: p.id,
    tracking_number: p.tracking_number,
    consignee: p.consignee,
    pcs: p.pcs,
    weight: p.weight,
    volume_cbm: p.volume_cbm,
    cost: p.cost,
    chargeable_weight: p.weight,
    unit_price_usd: p.unit_price_usd,
    total_price_rmb: p.total_price_rmb,
    total_price_usd: p.total_price_usd,
    total_price_kes: p.total_price_kes,
    payment_mode: p.payment_mode,
    manifest_line_date: p.manifest_line_date,
    manifest_signature: p.manifest_signature,
    warehouse_received_date: p.warehouse_received_date,
    warehouse_receipt_number: p.warehouse_receipt_number,
    container_position: p.container_position,
    billing_formula: p.billing_formula,
    billing_amount: p.billing_amount,
    billing_currency: p.billing_currency,
    billing_rate: p.billing_rate,
    description: p.description,
    mode: category === "sea" ? "sea" : "air",
    cargo_category: category,
    origin: category === "sea" ? "China" : "Guangzhou",
    dest: "Nairobi",
    status: "registered",
    manifest_id: manifestId,
    manifest_name: upload.name,
    imported_by: user.id,
    imported_at: new Date().toISOString(),
    created_by: user.id,
    manifest_data: p.manifest_data as never,
  }));
  const { error: insertError } = payload.length ? await supabaseAdmin.from("cargo_packages").insert(payload) : { error: null };
  if (insertError) return Response.json({ error: insertError.message, ...preview }, { status: 400 });
  await supabaseAdmin.from("manifest_imports").insert({ id: manifestId, category, source_file_name: upload.name, total_rows: parsed.length, imported_rows: payload.length, duplicate_rows: duplicates.length, invalid_rows: invalid.length, imported_by: user.id, notes: { header_format: category === "sea" ? "sea_chinese" : "air" } });
  return Response.json({ ok: true, manifest_id: manifestId, imported_rows: payload.length, ...preview });
} } } });

const { app, BrowserWindow, dialog, ipcMain, Menu, net, safeStorage, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createHash } = require("node:crypto");
const { OfflineStore } = require("./offline-store.cjs");

const DEFAULT_SUPABASE_URL = "https://bxbpuqzrbvkfrmwohqwd.supabase.co";
const DEFAULT_SUPABASE_KEY = "sb_publishable_2aAwawQ3-zBwZTu3lE6n6Q__-g2fWsN";
const DEFAULT_API_BASE = "https://project--5e9b81ad-6c63-4331-af7a-01008019e17f.lovable.app";
const LIVE_UI_URL = "https://swift-creation-app.lovable.app/";
const LIVE_UI_ORIGIN = new URL(LIVE_UI_URL).origin;
const PRODUCT_NAME = "DEXCARGO Desktop";
let mainWindow;
let store;
let realtimeClient;
let realtimeChannel;
let allowedApiBase = process.env.DEX_API_BASE_URL || DEFAULT_API_BASE;
let manualUpdateCheck = false;
let updateCheckInFlight = false;

function safeUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

function defaultConnection() {
  const url = safeUrl(process.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL)?.toString().replace(/\/$/, "") || DEFAULT_SUPABASE_URL;
  return {
    url,
    key: process.env.VITE_SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_KEY,
  };
}

function senderUrlIsTrusted(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ""));
    if (url.protocol === "https:" && url.origin === LIVE_UI_ORIGIN) return true;
    return url.href === pathToFileURL(path.join(app.getAppPath(), "public", "desktop-shell.html")).href;
  } catch {
    return false;
  }
}

function senderIsApp(event) {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id) return false;
  const frame = event.senderFrame;
  if (!frame || frame !== mainWindow.webContents.mainFrame) return false;
  return senderUrlIsTrusted(frame.url);
}

function assertAppSender(event) {
  if (!senderIsApp(event)) throw new Error("Untrusted desktop window.");
}

function toHeaderObject(headers) {
  const result = {};
  if (!headers) return result;
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) continue;
    const lower = key.toLowerCase();
    if (["cookie", "host", "content-length", "connection"].includes(lower)) continue;
    result[key] = String(value);
  }
  return result;
}

function endpointTable(rawUrl) {
  const parsed = new URL(rawUrl);
  const match = parsed.pathname.match(/^\/rest\/v1\/([a-zA-Z0-9_]+)$/);
  return match ? match[1] : `api:${parsed.pathname}`;
}

function contentHeaders(response) {
  const type = response.headers.get("content-type");
  return type ? { "content-type": type } : {};
}

function responsePayload(status, body, headers = {}, extras = {}) {
  return { status, body: body ?? "", headers, ...extras };
}

function sameJson(left, right) {
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    }
    return value;
  };
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function applyPatch(base, patch) {
  return { ...base, ...patch };
}

function setResponseToWebContents(kind, value) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(kind, value);
}

async function fetchAndCache({ url, method, headers, body, userId }) {
  const response = await fetch(url, { method, headers, body });
  const text = await response.text();
  const responseHeaders = contentHeaders(response);
  const tableName = endpointTable(url);
  if (method === "GET" && response.ok && userId && /json/i.test(responseHeaders["content-type"] || "")) {
    store.putSnapshot(userId, url, tableName, {
      status: response.status,
      headers: responseHeaders,
      body: text,
      savedAt: new Date().toISOString(),
    });
  }
  if (method !== "GET" && response.ok && userId) {
    if (tableName === "cargo_packages") store.invalidateTable(userId, "cargo_packages");
    if (tableName.startsWith("api:") && /\/api\/public\/packages\/[^/]+\/(location|operations)$/.test(new URL(url).pathname)) {
      store.invalidateTable(userId, "cargo_packages");
    }
  }
  return responsePayload(response.status, text, responseHeaders);
}

function cachedResponse(userId, url) {
  const snapshot = store.getSnapshot(userId, url);
  if (!snapshot) return null;
  return responsePayload(snapshot.status || 200, snapshot.body || "", {
    ...(snapshot.headers || {}),
    "x-dex-cache": "offline",
    "x-dex-snapshot-at": snapshot.savedAt || "",
  }, { fromCache: true });
}

async function handleRequest(event, input) {
  assertAppSender(event);
  const url = safeUrl(input?.url);
  if (!url) return responsePayload(400, JSON.stringify({ error: "Only HTTPS API requests are permitted." }), { "content-type": "application/json" });
  const connection = store.getSecureValue("connection") || defaultConnection();
  const allowedOrigins = new Set([
    safeUrl(connection.url)?.origin,
    safeUrl(allowedApiBase)?.origin,
    safeUrl(process.env.DEX_API_BASE_URL || "")?.origin,
    LIVE_UI_ORIGIN,
  ].filter(Boolean));
  if (!allowedOrigins.has(url.origin)) {
    return responsePayload(403, JSON.stringify({ error: "This API origin is not configured for DEXCARGO Desktop." }), { "content-type": "application/json" });
  }

  const method = String(input.method || "GET").toUpperCase();
  const headers = toHeaderObject(input.headers);
  const body = typeof input.body === "string" ? input.body : undefined;
  const userId = typeof input.userId === "string" && input.userId.length < 100 ? input.userId : null;
  try {
    const result = await fetchAndCache({ url: url.toString(), method, headers, body, userId });
    return result;
  } catch (error) {
    if (method === "GET") {
      const cached = cachedResponse(userId, url.toString());
      if (cached) return cached;
    }
    if (method !== "GET") {
      try {
        const queued = store.queuePackageMutation(userId, {
          url: url.toString(),
          method,
          headers,
          body,
        });
        setResponseToWebContents("dex:sync-status", store.syncStatus(userId, net.isOnline()));
        return responsePayload(202, JSON.stringify({
          ok: true,
          queued: true,
          operation_id: queued.operationId,
          package: queued.optimistic,
          merged: queued.merged,
        }), {
          "content-type": "application/json",
          "x-dex-queued": "true",
          "x-dex-operation-id": queued.operationId,
        }, { queued: true, operationId: queued.operationId });
      } catch (queueError) {
        return responsePayload(503, JSON.stringify({ error: queueError.message || "This action is unavailable offline." }), { "content-type": "application/json" });
      }
    }
    return responsePayload(503, JSON.stringify({ error: net.isOnline() ? "The DEX service could not be reached. The edit was not saved." : "No network connection." }), { "content-type": "application/json" });
  }
}

function getSupabaseUrl() {
  const connection = store.getSecureValue("connection") || defaultConnection();
  return safeUrl(connection.url)?.toString().replace(/\/$/, "") || DEFAULT_SUPABASE_URL;
}

function makeHeaders(accessToken, key) {
  return {
    apikey: key,
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
}

async function remotePackage(userId, packageId, accessToken) {
  const connection = store.getSecureValue("connection") || defaultConnection();
  const url = `${getSupabaseUrl()}/rest/v1/cargo_packages?id=eq.${encodeURIComponent(packageId)}&select=id,location,commission_employee_id,is_international_forwarding,forward_destination_country`;
  const response = await fetch(url, { headers: makeHeaders(accessToken, connection.key) });
  const text = await response.text();
  if (!response.ok) return { response, error: text };
  const rows = text ? JSON.parse(text) : [];
  if (Array.isArray(rows)) store.putSnapshot(userId, url, "cargo_packages", { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(rows), savedAt: new Date().toISOString() });
  return { response, rows: Array.isArray(rows) ? rows : [] };
}

async function syncOutbox(event, { userId, accessToken }) {
  assertAppSender(event);
  if (!userId || !accessToken) return { synced: 0, pending: 0, conflict: 0, error: "Sign in to sync queued edits." };
  if (!net.isOnline()) return store.syncStatus(userId, false);
  const queued = store.listOutbox(userId, ["queued"]);
  let synced = 0;
  for (const item of queued) {
    const operation = item.payload;
    store.setOutboxStatus(item.operationId, "syncing");
    try {
      const remote = await remotePackage(userId, operation.packageId, accessToken);
      if (remote.response.status === 401) {
        store.setOutboxStatus(item.operationId, "queued", "authentication_required");
        break;
      }
      if (remote.response.status >= 500) {
        store.setOutboxStatus(item.operationId, "queued", "network_error");
        break;
      }
      if (!remote.response.ok) {
        store.setOutboxStatus(item.operationId, "conflict", `package_read_rejected_${remote.response.status}`);
        continue;
      }
      const current = remote.rows.find((row) => String(row.id) === String(operation.packageId));
      if (!current) {
        store.setOutboxStatus(item.operationId, "conflict", "package_missing");
        continue;
      }
      const currentValues = Object.fromEntries(Object.keys(operation.patch).map((key) => [key, current[key] ?? null]));
      const alreadyApplied = Object.entries(operation.patch).every(([key, value]) => sameJson(current[key] ?? null, value ?? null));
      if (alreadyApplied) {
        store.finishOutboxOperation(item.operationId, userId, operation.packageId);
        synced += 1;
        continue;
      }
      if (!sameJson(currentValues, operation.baseFields)) {
        store.setOutboxStatus(item.operationId, "conflict", "record_changed_online");
        continue;
      }
      const apiUrl = `${allowedApiBase.replace(/\/$/, "")}/api/public/packages/${encodeURIComponent(operation.packageId)}/${operation.endpoint}`;
      const response = await fetch(apiUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": item.operationId,
        },
        body: JSON.stringify(operation.patch),
      });
      const responseText = await response.text();
      if (response.ok) {
        store.finishOutboxOperation(item.operationId, userId, operation.packageId);
        store.invalidateTable(userId, "cargo_packages");
        synced += 1;
        continue;
      }
      if (response.status === 401) {
        store.setOutboxStatus(item.operationId, "queued", "authentication_required");
        break;
      }
      if (response.status >= 500) {
        store.setOutboxStatus(item.operationId, "queued", "server_unavailable");
        break;
      }
      store.setOutboxStatus(item.operationId, "conflict", `server_rejected_${response.status}`);
      void responseText;
    } catch {
      store.setOutboxStatus(item.operationId, "queued", "network_error");
      break;
    }
  }
  const status = store.syncStatus(userId, net.isOnline());
  status.syncedThisRun = synced;
  setResponseToWebContents("dex:sync-status", status);
  return status;
}

async function startRealtime(event, { url, key, accessToken }) {
  assertAppSender(event);
  const safeSupabaseUrl = safeUrl(url);
  if (!safeSupabaseUrl || !String(key || "").startsWith("sb_publishable_")) return { ok: false };
  if (realtimeClient) {
    try { await realtimeClient.removeChannel(realtimeChannel); } catch {}
    realtimeClient = null;
    realtimeChannel = null;
  }
  try {
    const { createClient } = await import("@supabase/supabase-js");
    realtimeClient = createClient(safeSupabaseUrl.toString().replace(/\/$/, ""), key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    realtimeClient.realtime.setAuth(accessToken);
    realtimeChannel = realtimeClient
      .channel(`dex-desktop-${createHash("sha256").update(accessToken).digest("hex").slice(0, 10)}`)
      .on("postgres_changes", { event: "*", schema: "public" }, () => setResponseToWebContents("dex:remote-change"))
      .subscribe();
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

async function stopRealtime(event) {
  assertAppSender(event);
  if (realtimeClient && realtimeChannel) {
    try { await realtimeClient.removeChannel(realtimeChannel); } catch {}
  }
  realtimeClient = null;
  realtimeChannel = null;
  return true;
}

async function savePdf(event, { html, fileName } = {}) {
  assertAppSender(event);
  const safeName = path.basename(String(fileName || "DEX-Report.pdf")).replace(/[^a-zA-Z0-9._-]/g, "_");
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: "Save DEX report",
    defaultPath: safeName.endsWith(".pdf") ? safeName : `${safeName}.pdf`,
    filters: [{ name: "PDF document", extensions: ["pdf"] }],
  });
  if (canceled || !filePath) return { canceled: true };
  const printWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(String(html || ""))}`);
    const pdf = await printWindow.webContents.printToPDF({ printBackground: true, pageSize: "A4" });
    fs.writeFileSync(filePath, pdf);
    return { canceled: false, filePath };
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy();
  }
}

function registerIpc() {
  ipcMain.handle("dex:connection:get", (event) => { assertAppSender(event); return store.getSecureValue("connection") || defaultConnection(); });
  ipcMain.handle("dex:connection:save", (event, value) => {
    assertAppSender(event);
    const url = safeUrl(value?.url);
    const key = String(value?.key || "").trim();
    if (!url || !key || key.length > 4096) throw new Error("Enter a valid HTTPS Supabase URL and publishable key.");
    const connection = { url: url.toString().replace(/\/$/, ""), key };
    store.setSecureValue("connection", connection);
    return true;
  });
  ipcMain.handle("dex:session:get", (event) => { assertAppSender(event); return store.getSecureValue("session"); });
  ipcMain.handle("dex:session:save", (event, session) => {
    assertAppSender(event);
    if (!session || typeof session.access_token !== "string" || typeof session.refresh_token !== "string" || !session.user?.id) {
      throw new Error("Refusing to persist an invalid authentication session.");
    }
    store.setSecureValue("session", session);
    return true;
  });
  ipcMain.handle("dex:session:clear", async (event) => { assertAppSender(event); await stopRealtime(event); store.deleteSecureValue("session"); return true; });
  ipcMain.handle("dex:request", handleRequest);
  ipcMain.handle("dex:sync:run", syncOutbox);
  ipcMain.handle("dex:sync:status", (event, userId) => { assertAppSender(event); return store.syncStatus(userId, net.isOnline()); });
  ipcMain.handle("dex:realtime:start", startRealtime);
  ipcMain.handle("dex:realtime:stop", stopRealtime);
  ipcMain.handle("dex:external:open", async (event, rawUrl) => {
    assertAppSender(event);
    const url = safeUrl(rawUrl);
    if (!url) return false;
    await shell.openExternal(url.toString());
    return true;
  });
  ipcMain.handle("dex:app:reload", (event) => { assertAppSender(event); mainWindow?.reload(); return true; });
  ipcMain.handle("dex:report:pdf", savePdf);
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1024,
    minHeight: 700,
    icon: path.join(app.getAppPath(), "public", "assets", "dexcargo.ico"),
    title: PRODUCT_NAME,
    backgroundColor: "#07131d",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const parsed = safeUrl(url);
    if (parsed) void shell.openExternal(parsed.toString());
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (!senderUrlIsTrusted(target)) event.preventDefault();
  });
  mainWindow.webContents.on("will-redirect", (event, target) => {
    if (!senderUrlIsTrusted(target)) event.preventDefault();
  });
  const localShellPath = path.join(app.getAppPath(), "public", "desktop-shell.html");
  if (app.isPackaged) {
    let timeoutId;
    try {
      const navigation = mainWindow.loadURL(LIVE_UI_URL);
      const deadline = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.stop();
          reject(new Error("Published DEX UI did not load before the offline startup deadline."));
        }, 7000);
      });
      await Promise.race([navigation, deadline]);
      const bridgeReady = await mainWindow.webContents.executeJavaScript(`new Promise((resolve) => {
        const started = Date.now();
        const check = () => {
          if (window.__DEX_HOSTED_UI_READY__ === true) return resolve(true);
          if (Date.now() - started >= 5000) return resolve(false);
          setTimeout(check, 100);
        };
        check();
      })`);
      if (!bridgeReady) throw new Error("Published DEX UI did not initialize the desktop bridge.");
    } catch (error) {
      console.warn("Published DEX UI could not be reached; opening bundled offline UI.", error);
      await mainWindow.loadFile(localShellPath);
    } finally {
      clearTimeout(timeoutId);
    }
  } else {
    await mainWindow.loadFile(localShellPath);
  }
  mainWindow.on("closed", () => { mainWindow = null; });
}

function showUpdateMessage(options) {
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
}

async function checkForDesktopUpdates(manual = false) {
  if (!app.isPackaged) {
    if (manual) await showUpdateMessage({ type: "info", title: PRODUCT_NAME, message: "Updates are available in the installed app." });
    return;
  }
  if (updateCheckInFlight) return;
  updateCheckInFlight = true;
  manualUpdateCheck = manual;
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    updateCheckInFlight = false;
    const message = error instanceof Error ? error.message : String(error);
    console.error("[desktop-updater] Update check failed:", message);
    if (manual) await showUpdateMessage({ type: "error", title: PRODUCT_NAME, message: `Could not check for updates. ${message}` });
  }
}

function configureDesktopUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on("checking-for-update", () => console.info("[desktop-updater] Checking for updates."));
  autoUpdater.on("update-available", (info) => {
    updateCheckInFlight = false;
    console.info(`[desktop-updater] Downloading version ${info.version}.`);
    if (manualUpdateCheck) void showUpdateMessage({ type: "info", title: PRODUCT_NAME, message: `Version ${info.version} is available and will download in the background.` });
  });
  autoUpdater.on("update-not-available", (info) => {
    updateCheckInFlight = false;
    if (manualUpdateCheck) void showUpdateMessage({ type: "info", title: PRODUCT_NAME, message: `You are up to date (version ${info.version}).` });
  });
  autoUpdater.on("download-progress", (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setProgressBar(Math.max(0, Math.min(1, progress.percent / 100)));
  });
  autoUpdater.on("update-downloaded", async (info) => {
    updateCheckInFlight = false;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setProgressBar(-1);
    const result = await showUpdateMessage({
      type: "info",
      title: PRODUCT_NAME,
      message: `Version ${info.version} is ready to install. Restart the app to finish updating.`,
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) autoUpdater.quitAndInstall(false, true);
  });
  autoUpdater.on("error", (error) => {
    updateCheckInFlight = false;
    console.error("[desktop-updater] Update failed:", error);
    if (manualUpdateCheck) void showUpdateMessage({ type: "error", title: PRODUCT_NAME, message: `The update could not be completed. ${error.message || error}` });
  });

  const menu = Menu.buildFromTemplate([
    {
      label: "DEXCARGO",
      submenu: [
        { label: "Check for updates…", click: () => void checkForDesktopUpdates(true) },
        { type: "separator" },
        { role: "quit" },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
  void checkForDesktopUpdates();
  const updateTimer = setInterval(() => void checkForDesktopUpdates(), 6 * 60 * 60 * 1000);
  updateTimer.unref();
}

app.whenReady().then(async () => {
  const initSqlJs = require("sql.js");
  const wasmPath = app.isPackaged
    ? path.join(process.resourcesPath, "sql-wasm.wasm")
    : path.join(path.dirname(require.resolve("sql.js")), "sql-wasm.wasm");
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  store = new OfflineStore({
    SQL,
    dbPath: path.join(app.getPath("userData"), "dex-offline.sqlite"),
    safeStorage,
  }).open();
  registerIpc();
  await createWindow();
  configureDesktopUpdates();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
}).catch((error) => {
  dialog.showErrorBox(PRODUCT_NAME, error.message || "Secure local storage could not be started.");
  app.quit();
});

app.on("before-quit", () => {
  try { store?.close(); } catch {}
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

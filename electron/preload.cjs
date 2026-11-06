const { contextBridge, ipcRenderer } = require("electron");

function listen(channel, callback) {
  if (typeof callback !== "function") return () => {};
  const handler = (_event, value) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("dexAdmin", Object.freeze({
  isElectron: true,
  getConnection: () => ipcRenderer.invoke("dex:connection:get"),
  saveConnection: (value) => ipcRenderer.invoke("dex:connection:save", value),
  getSession: () => ipcRenderer.invoke("dex:session:get"),
  saveSession: (session) => ipcRenderer.invoke("dex:session:save", session),
  clearSession: () => ipcRenderer.invoke("dex:session:clear"),
  reloadHosted: () => ipcRenderer.invoke("dex:app:reload"),
  openExternal: (url) => ipcRenderer.invoke("dex:external:open", String(url || "")),
  savePdf: (options) => ipcRenderer.invoke("dex:report:pdf", options || {}),
  apiRequest: (request) => ipcRenderer.invoke("dex:request", request),
  syncOutbox: (userId, accessToken) => ipcRenderer.invoke("dex:sync:run", { userId, accessToken }),
  syncStatus: (userId) => ipcRenderer.invoke("dex:sync:status", userId),
  startRealtime: (connection) => ipcRenderer.invoke("dex:realtime:start", connection),
  stopRealtime: () => ipcRenderer.invoke("dex:realtime:stop"),
  onRemoteChange: (callback) => listen("dex:remote-change", callback),
  onNetworkChange: (callback) => listen("dex:network", callback),
  onSyncStatus: (callback) => listen("dex:sync-status", callback),
}));

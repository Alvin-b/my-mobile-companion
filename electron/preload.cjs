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
  checkForUpdates: () => ipcRenderer.invoke("dex:app:check-updates"),
  exitApp: () => ipcRenderer.invoke("dex:app:exit"),
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

window.addEventListener("DOMContentLoaded", () => {
  if (!window.dexAdmin?.isElectron) return;
  const badgeSelectors = [
    "#lovable-badge",
    "[id*='lovable' i]",
    "[class*='lovable' i]",
    "[data-lovable-badge]",
    "lovable-badge",
    "a[href*='lovable.dev']",
    "a[href*='lovable.app']",
    "iframe[src*='lovable.dev']",
    "iframe[src*='lovable.app']",
  ].join(",");
  const hideLovableBadge = () => {
    document.querySelectorAll(badgeSelectors).forEach((node) => node.remove());
    document.querySelectorAll("a,button,[role='button'],[aria-label],[title],span,div").forEach((node) => {
      const label = [node.innerText, node.getAttribute("aria-label"), node.getAttribute("title")]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (label.length > 120 || !/\bedit\s+with\s+lovable\b/i.test(label)) return;
      let target = node;
      for (let depth = 0; depth < 5; depth += 1) {
        const parent = target.parentElement;
        if (!parent || parent === document.body) break;
        const style = window.getComputedStyle(parent);
        const bounds = parent.getBoundingClientRect();
        const overlay = style.position === "fixed" || style.position === "absolute" || Number(style.zIndex) > 100;
        if (!overlay || bounds.width > 480 || bounds.height > 220) break;
        target = parent;
      }
      target.remove();
    });
  };
  const scheduleBadgeSweep = (() => {
    let queued = false;
    return () => {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(() => {
        queued = false;
        hideLovableBadge();
      });
    };
  })();
  const badgeStyle = document.createElement("style");
  badgeStyle.textContent = `${badgeSelectors}{display:none!important;visibility:hidden!important;pointer-events:none!important}`;
  document.head.appendChild(badgeStyle);
  hideLovableBadge();
  const badgeObserver = new MutationObserver(scheduleBadgeSweep);
  badgeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["aria-label", "class", "href", "id", "src", "title"],
    childList: true,
    subtree: true,
  });

  if (document.getElementById("dex-desktop-bar")) return;
  const style = document.createElement("style");
  style.textContent = `
    body{box-sizing:border-box!important;height:100vh!important;padding-top:36px!important}
    #dex-desktop-bar{position:fixed;z-index:2147483000;inset:0 0 auto;height:36px;background:#07131d;color:#e7f0f8;display:flex;align-items:center;padding:0 8px;-webkit-app-region:drag;font:13px 'Segoe UI',Arial,sans-serif;border-bottom:1px solid #102736}
    #dex-desktop-bar button{font:inherit;color:inherit;border:0;background:transparent;cursor:pointer;-webkit-app-region:no-drag}
    #dex-brand-menu{height:29px;padding:0 13px;border-radius:5px;font-weight:700;letter-spacing:.04em}
    #dex-brand-menu:hover,#dex-brand-menu[aria-expanded='true']{background:#153044}
    #dex-menu-panel{position:absolute;top:32px;left:8px;min-width:190px;padding:5px;background:#0d202d;border:1px solid #284253;border-radius:7px;box-shadow:0 8px 24px #0008;display:none;-webkit-app-region:no-drag}
    #dex-menu-panel.open{display:block}
    #dex-menu-panel button{display:block;width:100%;text-align:left;padding:9px 11px;border-radius:4px}
    #dex-menu-panel button:hover{background:#1b394c}
    #dex-menu-panel .exit{color:#ffb36b}
  `;
  document.head.appendChild(style);
  const bar = document.createElement("div");
  bar.id = "dex-desktop-bar";
  bar.innerHTML = `<button id="dex-brand-menu" aria-expanded="false" aria-haspopup="true">DEXCARGO ▾</button><div id="dex-menu-panel" role="menu"><button role="menuitem" data-action="updates">Check for updates…</button><button class="exit" role="menuitem" data-action="exit">Exit</button></div>`;
  document.body.appendChild(bar);
  const opener = bar.querySelector("#dex-brand-menu");
  const panel = bar.querySelector("#dex-menu-panel");
  opener.addEventListener("click", () => {
    const open = panel.classList.toggle("open");
    opener.setAttribute("aria-expanded", String(open));
  });
  panel.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    panel.classList.remove("open");
    opener.setAttribute("aria-expanded", "false");
    if (action === "updates") void window.dexAdmin.checkForUpdates();
    if (action === "exit") void window.dexAdmin.exitApp();
  });
  document.addEventListener("click", (event) => {
    if (!bar.contains(event.target)) {
      panel.classList.remove("open");
      opener.setAttribute("aria-expanded", "false");
    }
  });
});

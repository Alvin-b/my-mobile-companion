import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

type Connection = { url: string; key: string };
type DesktopBridge = {
  __DEX_CONFIG__: Connection;
  __DEX_ADMIN_BACKEND__: string;
  __DEX_RENDERER_SCRIPT_STARTED__?: boolean;
  __DEX_HOSTED_UI_READY__?: boolean;
  dexAdmin: {
    isElectron?: boolean;
    getConnection: () => Promise<Partial<Connection>>;
    saveConnection: (value: unknown) => Promise<boolean>;
    getSession: () => Promise<unknown | null>;
    saveSession: (value: unknown) => Promise<boolean>;
    clearSession: () => Promise<boolean>;
    reloadHosted: () => Promise<boolean>;
    openExternal: (url: string) => Promise<boolean>;
    savePdf: (options?: {
      html?: string;
      fileName?: string;
    }) => Promise<{ canceled: boolean; filePath?: string }>;
  };
};

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DEX Admin Console" },
      { name: "description", content: "DEXCARGO desktop operations console." },
    ],
  }),
  component: DesktopConsole,
});

function readStoredValue<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function DesktopConsole() {
  useEffect(() => {
    const connection = {
      url: import.meta.env.VITE_SUPABASE_URL || "https://bxbpuqzrbvkfrmwohqwd.supabase.co",
      key:
        import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
        "sb_publishable_2aAwawQ3-zBwZTu3lE6n6Q__-g2fWsN",
    };
    const bridge = window as unknown as DesktopBridge;
    bridge.__DEX_CONFIG__ = connection;
    bridge.__DEX_ADMIN_BACKEND__ = window.location.origin;

    const connectionKey = "dex-console.connection";
    const sessionKey = "dex-console.session";
    if (!bridge.dexAdmin?.isElectron) {
      bridge.dexAdmin = {
      getConnection: async () => ({
        ...connection,
        ...readStoredValue(connectionKey, {}),
      }),
      saveConnection: async (value: unknown) => {
        window.localStorage.setItem(connectionKey, JSON.stringify(value));
        return true;
      },
      getSession: async () => readStoredValue<unknown | null>(sessionKey, null),
      saveSession: async (value: unknown) => {
        window.localStorage.setItem(sessionKey, JSON.stringify(value));
        return true;
      },
      clearSession: async () => {
        window.localStorage.removeItem(sessionKey);
        return true;
      },
      reloadHosted: async () => {
        window.location.reload();
        return true;
      },
      openExternal: async (rawUrl: string) => {
        try {
          const url = new URL(rawUrl);
          if (url.protocol !== "https:") return false;
          window.open(url.toString(), "_blank", "noopener,noreferrer");
          return true;
        } catch {
          return false;
        }
      },
      savePdf: async ({ html, fileName }: { html?: string; fileName?: string } = {}) => {
        const printWindow = window.open("", "_blank");
        if (!printWindow) return { canceled: true };
        printWindow.addEventListener("load", () => printWindow.print(), { once: true });
        printWindow.document.open();
        printWindow.document.write(String(html || ""));
        printWindow.document.close();
        printWindow.document.title = fileName || "DEX-Commissions.pdf";
        return { canceled: false, filePath: fileName || "DEX-Commissions.pdf" };
      },
      };
    }

    const styleId = "dex-console-styles";
    if (!document.getElementById(styleId)) {
      const link = document.createElement("link");
      link.id = styleId;
      link.rel = "stylesheet";
      link.href = "/desktop-console.css";
      document.head.appendChild(link);
    }

    const scriptId = "dex-console-renderer";
    bridge.__DEX_HOSTED_UI_READY__ = false;
    if (document.getElementById(scriptId) || bridge.__DEX_RENDERER_SCRIPT_STARTED__) {
      bridge.__DEX_HOSTED_UI_READY__ = true;
    } else {
      bridge.__DEX_RENDERER_SCRIPT_STARTED__ = true;
      const script = document.createElement("script");
      script.id = scriptId;
      script.src = "/desktop-renderer.js";
      script.onload = () => {
        bridge.__DEX_HOSTED_UI_READY__ = true;
      };
      script.onerror = () => {
        bridge.__DEX_HOSTED_UI_READY__ = false;
        const mount = document.getElementById("app");
        if (mount) {
          mount.innerHTML =
            '<div style="min-height:100vh;display:grid;place-items:center;padding:24px;background:#0c0a1d;color:#f7f5ff;font:500 16px/1.5 system-ui,sans-serif;text-align:center"><div><strong style="display:block;font-size:20px;margin-bottom:8px">DEX Admin Console could not load</strong><span style="color:#aaa5c7">Refresh the page to retry loading the desktop interface.</span></div></div>';
        }
      };
      document.body.appendChild(script);
    }
  }, []);

  return <div id="app" />;
}

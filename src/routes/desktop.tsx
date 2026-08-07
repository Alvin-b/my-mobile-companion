import { createFileRoute, Outlet } from "@tanstack/react-router";
import { DesktopShell } from "@/components/desktop/DesktopShell";

export const Route = createFileRoute("/desktop")({
  head: () => ({
    meta: [
      { title: "Admin Console — DEXCARGO Ops Desktop" },
      { name: "description", content: "Desktop administrator console for DEXCARGO cargo operations: live metrics, revenue graphs, commission ledgers and staff management." },
      { property: "og:title", content: "DEXCARGO Admin Console" },
      { property: "og:description", content: "Live cargo, revenue and commission analytics for DEXCARGO administrators." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <DesktopShell>
      <Outlet />
    </DesktopShell>
  ),
});
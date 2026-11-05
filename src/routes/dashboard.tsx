import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "DEX Admin Console | Dashboard" },
      { name: "description", content: "Open the DEXCARGO operations dashboard." },
      { property: "og:title", content: "DEX Admin Console | Dashboard" },
      { property: "og:description", content: "Open the DEXCARGO operations dashboard." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
  component: () => null,
});
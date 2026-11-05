import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: () => <main className="min-h-screen" aria-label="New interface canvas" />,
});

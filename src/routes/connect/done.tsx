import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The GitHub App's Setup URL: GitHub sends the owner here after installing.
 * The dashboard picks up the pasted ticket and the new projects.
 */
export const Route = createFileRoute("/connect/done")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});

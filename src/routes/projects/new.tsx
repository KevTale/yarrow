import { createFileRoute, redirect } from "@tanstack/react-router";

/** Projects come from the GitHub App's installation, one per repository. */
export const Route = createFileRoute("/projects/new")({
  beforeLoad: () => {
    throw redirect({ href: "/connect/github" });
  },
});

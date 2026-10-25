import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

/**
 * The GitHub App's Setup URL: GitHub sends the owner here after installing,
 * often before its webhook has created the projects. The dashboard waits
 * for them, and picks up the pasted ticket.
 */
export const Route = createFileRoute("/connect/done")({
  validateSearch: z.object({
    installation_id: z.union([z.number(), z.string()]).optional(),
  }),
  beforeLoad: ({ search }) => {
    const id = String(search.installation_id ?? "");
    const installation = /^\d+$/.test(id) ? Number(id) : undefined;
    throw redirect({
      to: "/dashboard",
      search: installation
        ? { tab: "builder", installation }
        : { tab: "builder" },
    });
  },
});

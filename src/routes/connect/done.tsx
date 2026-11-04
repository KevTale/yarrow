import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

/**
 * The GitHub App's Setup URL: GitHub sends the owner here after installing,
 * often before its webhook has created the projects. The setup waits for
 * them. A member who is not an admin of the organization only asked its
 * admins (`setup_action=request`).
 */
export const Route = createFileRoute("/connect/done")({
  validateSearch: z.object({
    installation_id: z.union([z.number(), z.string()]).optional(),
    setup_action: z.string().optional(),
  }),
  beforeLoad: ({ search }) => {
    const id = String(search.installation_id ?? "");
    const installation = /^\d+$/.test(id) ? Number(id) : undefined;
    if (search.setup_action === "request")
      throw redirect({
        to: "/dashboard",
        search: { requested: true },
      });
    throw redirect({ to: "/start", search: { installation } });
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { recordSponsorClick } from "@/db/boards";
import { databaseConfigured, withDb } from "@/server/db.server";

/** A sponsor's website link on the boards: counts the click, then redirects. */
export const Route = createFileRoute("/out/$sponsorId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const valid = /^[0-9a-f-]{36}$/.test(params.sponsorId);
        const target =
          valid && databaseConfigured()
            ? await withDb((db) => recordSponsorClick(db, params.sponsorId))
            : null;
        return new Response(null, {
          status: 302,
          headers: { Location: target ?? "/" },
        });
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { readImage } from "@/db/images";
import { databaseConfigured, withDb } from "@/server/db.server";

/** Uploaded logos. Named by their SHA-256, so they cache forever. */
export const Route = createFileRoute("/images/$name")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const image = databaseConfigured()
          ? await withDb((db) => readImage(db, params.name))
          : null;
        if (!image) return new Response("Not found", { status: 404 });
        return new Response(new Uint8Array(image.bytes), {
          headers: {
            "Content-Type": image.contentType,
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});

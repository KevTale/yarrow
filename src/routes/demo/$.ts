import { createFileRoute } from "@tanstack/react-router";
import { byteRange, span } from "@/core/byte-range";
import { appEnv } from "@/server/env.server";

/**
 * The landing's film, from the site's own files. Static files answer a Range
 * with the whole file: a player cannot seek in that and Safari will not play
 * it, so `run_worker_first` sends them here (wrangler.jsonc).
 */
export const Route = createFileRoute("/demo/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const assets = appEnv().ASSETS;
        if (!assets) return new Response("Not found", { status: 404 });
        const file = await assets.fetch(new URL(request.url));
        if (!file.ok) return file;
        const headers = new Headers(file.headers);
        headers.set("Accept-Ranges", "bytes");
        const range = byteRange(request.headers.get("range"));
        if (!range) return new Response(file.body, { headers });
        const bytes = await file.arrayBuffer();
        const size = bytes.byteLength;
        const { offset, length } = span(range, size);
        if (offset >= size || length <= 0)
          return new Response(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${size}` },
          });
        headers.set(
          "Content-Range",
          `bytes ${offset}-${offset + length - 1}/${size}`,
        );
        headers.set("Content-Length", String(length));
        return new Response(bytes.slice(offset, offset + length), {
          status: 206,
          headers,
        });
      },
    },
  },
});

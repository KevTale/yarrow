import { afterEach, describe, expect, it, vi } from "vitest";
import {
  declaredIcons,
  findFavicon,
  publicHost,
} from "../../src/server/favicon.server";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function serve(routes: Record<string, Response | (() => Response)>) {
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      asked.push(input);
      const route = routes[input];
      const response = typeof route === "function" ? route() : route;
      return response ?? new Response("", { status: 404 });
    }),
  );
  return asked;
}
const image = (type = "image/png") =>
  new Response(png, { headers: { "content-type": type } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("favicon", () => {
  it("only fetches public https hosts", () => {
    expect(publicHost("https://acme.com/about")).toBe("acme.com");
    expect(publicHost("http://acme.com/")).toBeNull();
    expect(publicHost("https://127.0.0.1/")).toBeNull();
    expect(publicHost("https://intranet/")).toBeNull();
    expect(publicHost("https://acme.com:8443/")).toBeNull();
    expect(publicHost("https://app.localhost/")).toBeNull();
  });

  it("ranks the icons a page declares, apple-touch-icon first", () => {
    const html = `<head>
      <link rel="icon" href="/favicon-32.png" sizes="32x32">
      <link rel='apple-touch-icon' href='/apple.png'>
      <link href="https://cdn.acme.com/icon.svg" rel="icon" type="image/svg+xml">
      <link rel="stylesheet" href="/style.css">
      <link rel="shortcut icon" href="favicon.ico">
    </head>`;
    expect(
      declaredIcons(html, "https://acme.com/en/").map((c) => c.url),
    ).toEqual([
      "https://acme.com/apple.png",
      "https://cdn.acme.com/icon.svg",
      "https://acme.com/favicon-32.png",
      "https://acme.com/en/favicon.ico",
    ]);
  });

  it("takes the best declared icon as a data URL", async () => {
    const asked = serve({
      "https://acme.com/": new Response(
        '<link rel="apple-touch-icon" href="/apple.png"><link rel="icon" href="/f.ico">',
        { headers: { "content-type": "text/html; charset=utf-8" } },
      ),
      "https://acme.com/apple.png": image(),
    });
    expect(await findFavicon("https://acme.com/pricing")).toBe(
      `data:image/png;base64,${btoa(String.fromCharCode(...png))}`,
    );
    expect(asked).toEqual(["https://acme.com/", "https://acme.com/apple.png"]);
  });

  it("falls back to /favicon.ico, then Google, then nothing", async () => {
    serve({ "https://acme.com/favicon.ico": image("image/x-icon") });
    expect(await findFavicon("https://acme.com/")).toMatch(
      /^data:image\/x-icon;base64,/,
    );
    serve({
      "https://acme.com/favicon.ico": new Response("<html>", {
        headers: { "content-type": "text/html" },
      }),
      "https://www.google.com/s2/favicons?domain=acme.com&sz=128": image(),
    });
    expect(await findFavicon("https://acme.com/")).toMatch(/^data:image\/png/);
    serve({});
    expect(await findFavicon("https://acme.com/")).toBeNull();
  });
});

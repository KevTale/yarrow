import { describe, expect, it } from "vitest";
import {
  PREVIEW_COOKIE,
  PREVIEW_HEADER,
  fromApp,
  previewHost,
  previewPage,
  previewSignIn,
  previewUnit,
  rewritable,
  rewriteText,
  splitCookie,
  toApp,
} from "../../src/core/preview";

const UNIT = "0b7c6f8e-2d1a-4c3b-9e8f-1a2b3c4d5e6f";
const APP = "http://localhost:3000";
const PREVIEW = `https://${UNIT}-dev.yarrow.page`;

describe("preview hosts", () => {
  it("names a work unit's host and reads it back on its environment only", () => {
    expect(previewHost(UNIT, "-dev.yarrow.page")).toBe(
      `${UNIT}-dev.yarrow.page`,
    );
    expect(previewUnit(`${UNIT}-dev.yarrow.page`, "-dev.yarrow.page")).toBe(
      UNIT,
    );
    expect(previewUnit(`${UNIT}.yarrow.page`, ".yarrow.page")).toBe(UNIT);
    // Production's suffix does not take dev's hosts, nor anything else.
    expect(previewUnit(`${UNIT}-dev.yarrow.page`, ".yarrow.page")).toBeNull();
    expect(previewUnit("www.yarrow.page", ".yarrow.page")).toBeNull();
    expect(previewUnit(`${UNIT}.yarrow.run`, ".yarrow.page")).toBeNull();
    expect(previewUnit(`${UNIT}.yarrow.page`, "")).toBeNull();
  });
});

describe("cookies", () => {
  it("keeps the preview's session apart from the app's cookies", () => {
    expect(splitCookie(`a=1; ${PREVIEW_COOKIE}=s3cret; b=2`)).toEqual({
      session: "s3cret",
      rest: "a=1; b=2",
    });
    expect(splitCookie(`${PREVIEW_COOKIE}=s3cret`)).toEqual({
      session: "s3cret",
      rest: null,
    });
    expect(splitCookie(null)).toEqual({ session: null, rest: null });
  });
});

describe("requests to the app", () => {
  it("sends the app its own cookies, origin and referer only", () => {
    const headers = toApp(
      new Headers({
        cookie: `${PREVIEW_COOKIE}=s3cret; sid=abc`,
        origin: PREVIEW,
        referer: `${PREVIEW}/tasks?x=1`,
        [PREVIEW_HEADER]: "https://dev.yarrow.run",
        accept: "text/html",
      }),
      APP,
      PREVIEW,
    );
    expect(headers.get("cookie")).toBe("sid=abc");
    expect(headers.get("origin")).toBe(APP);
    expect(headers.get("referer")).toBe(`${APP}/tasks?x=1`);
    expect(headers.get(PREVIEW_HEADER)).toBeNull();
    expect(headers.get("accept")).toBe("text/html");
  });

  it("drops the Cookie header when only the preview's was sent", () => {
    const headers = toApp(
      new Headers({ cookie: `${PREVIEW_COOKIE}=s3cret` }),
      APP,
      PREVIEW,
    );
    expect(headers.has("cookie")).toBe(false);
  });
});

describe("responses from the app", () => {
  it("moves redirects and cookies to the preview's address", () => {
    const app = new Headers({ location: `${APP}/login?next=%2F` });
    app.append("set-cookie", "sid=abc; Path=/; Domain=localhost; HttpOnly");
    app.append("set-cookie", "theme=dark; Path=/");
    const headers = fromApp(app, APP, PREVIEW);
    expect(headers.get("location")).toBe(`${PREVIEW}/login?next=%2F`);
    expect(headers.getSetCookie()).toEqual([
      "sid=abc; Path=/; HttpOnly",
      "theme=dark; Path=/",
    ]);
  });

  it("leaves a relative redirect as it is", () => {
    const headers = fromApp(new Headers({ location: "/tasks" }), APP, PREVIEW);
    expect(headers.get("location")).toBe("/tasks");
  });

  it("rewrites the app's origin in what it writes, every way it is written", () => {
    const page = [
      `<a href="http://localhost:3000/tasks">`,
      `fetch("http://127.0.0.1:3000/api/tasks")`,
      `new WebSocket("ws://localhost:3000/_hmr")`,
      `<a href="https://github.com/x">`,
    ].join("\n");
    expect(rewriteText(page, APP, PREVIEW)).toBe(
      [
        `<a href="${PREVIEW}/tasks">`,
        `fetch("${PREVIEW}/api/tasks")`,
        `new WebSocket("wss://${UNIT}-dev.yarrow.page/_hmr")`,
        `<a href="https://github.com/x">`,
      ].join("\n"),
    );
    // Another port is another app: left as it is.
    expect(rewriteText("http://localhost:3001/x", APP, PREVIEW)).toBe(
      "http://localhost:3001/x",
    );
  });

  it("reads through text only, never images or fonts", () => {
    expect(rewritable("text/html; charset=utf-8")).toBe(true);
    expect(rewritable("application/javascript")).toBe(true);
    expect(rewritable("application/json")).toBe(true);
    expect(rewritable("image/png")).toBe(false);
    expect(rewritable("font/woff2")).toBe(false);
    expect(rewritable(null)).toBe(false);
  });
});

describe("the test account", () => {
  it("is the recipe's sign-in, as the member types it", () => {
    expect(previewSignIn("Seeded demo@tally.dev / demo1234 at /login")).toEqual(
      { login: "demo@tally.dev", password: "demo1234" },
    );
    expect(previewSignIn("No sign-in: the app is public.")).toBeNull();
    expect(previewSignIn(null)).toBeNull();
  });
});

describe("the preview's own pages", () => {
  it("refreshes while the app starts, and escapes what failed", () => {
    const starting = previewPage("starting", {
      dashboard: "https://dev.yarrow.run",
    });
    expect(starting).toContain('http-equiv="refresh"');
    expect(starting).toContain('href="https://dev.yarrow.run/dashboard"');
    const failed = previewPage("failed", {
      dashboard: "https://dev.yarrow.run",
      detail: "<script>alert(1)</script> exited 1",
    });
    expect(failed).not.toContain("<script>alert");
    expect(failed).toContain("&lt;script&gt;");
    expect(failed).not.toContain('http-equiv="refresh"');
  });
});

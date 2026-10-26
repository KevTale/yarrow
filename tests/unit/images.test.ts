import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  ImageError,
  MAX_IMAGE_BYTES,
  readImage,
  resolveLogo,
  storeImage,
} from "../../src/db/images";
import { createTestDatabase } from "./helpers/pglite";

const t = await createTestDatabase();
const { db } = t;
beforeEach(() => t.reset());
afterAll(() => t.pg.close());

/** A 1x1 transparent PNG. */
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const dataUrl = (type: string, base64: string) =>
  `data:${type};base64,${base64}`;

describe("uploaded logos", () => {
  it("stores an image under its hash and serves it back", async () => {
    const url = await storeImage(db, dataUrl("image/png", png));
    expect(url).toMatch(/^\/images\/[0-9a-f]{64}\.png$/);
    // The same bytes, uploaded again, keep the same address.
    expect(await storeImage(db, dataUrl("image/webp", png))).toBe(url);
    const image = await readImage(db, url.split("/").at(-1)!);
    expect(image?.contentType).toBe("image/png");
    expect(Buffer.from(image!.bytes).toString("base64")).toBe(png);
    expect(await readImage(db, "nope.png")).toBeNull();
  });

  it("refuses what is not a small PNG, JPEG or WebP", async () => {
    const svg = btoa('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    await expect(
      storeImage(db, dataUrl("image/svg+xml", svg)),
    ).rejects.toBeInstanceOf(ImageError);
    const huge = Buffer.alloc(MAX_IMAGE_BYTES + 1, 0x89).toString("base64");
    await expect(
      storeImage(db, dataUrl("image/png", huge)),
    ).rejects.toThrow("too large");
    await expect(storeImage(db, "https://example.com/a.png")).rejects.toThrow();
  });

  it("keeps, removes or replaces a logo from a form", async () => {
    expect(await resolveLogo(db, undefined)).toBeUndefined();
    expect(await resolveLogo(db, null)).toBeNull();
    const kept = `/images/${"a".repeat(64)}.webp`;
    expect(await resolveLogo(db, kept)).toBe(kept);
    expect(await resolveLogo(db, dataUrl("image/png", png))).toMatch(
      /^\/images\//,
    );
  });
});

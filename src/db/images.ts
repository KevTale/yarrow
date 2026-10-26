import { eq } from "drizzle-orm";
import type { Database } from "./client";
import { images } from "./schema";

/** Logos are drawn at 128 px by the browser before upload: a few KB. */
export const MAX_IMAGE_BYTES = 96 * 1024;

const extensions = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
} as const;
type ImageType = keyof typeof extensions;

/** What the bytes are, whatever the upload claimed. SVG is never accepted. */
function sniff(bytes: Uint8Array): ImageType | null {
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...bytes.subarray(from, to));
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

export class ImageError extends Error {}

/** A `data:image/...;base64,` URL from the browser, checked and stored. */
export async function storeImage(
  db: Database,
  dataUrl: string,
): Promise<string> {
  const match = /^data:image\/[\w+.-]+;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new ImageError("That image could not be read.");
  const bytes = Uint8Array.from(atob(match[1]!), (char) => char.charCodeAt(0));
  if (bytes.length > MAX_IMAGE_BYTES)
    throw new ImageError("That image is too large.");
  const contentType = sniff(bytes);
  if (!contentType)
    throw new ImageError("Use a PNG, JPEG or WebP image.");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const id = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  await db
    .insert(images)
    .values({ id, contentType, bytes })
    .onConflictDoNothing();
  return `/images/${id}.${extensions[contentType]}`;
}

const storedUrl = /^\/images\/[0-9a-f]{64}\.(webp|png|jpg)$/;

/**
 * A logo field from a form: undefined keeps the current logo, null removes
 * it, an /images/ URL is kept as is, and a data URL is a new upload.
 */
export async function resolveLogo(
  db: Database,
  input: string | null | undefined,
): Promise<string | null | undefined> {
  if (input === undefined || input === null) return input;
  if (storedUrl.test(input)) return input;
  return storeImage(db, input);
}

export async function readImage(
  db: Database,
  name: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const match = /^([0-9a-f]{64})\.(webp|png|jpg)$/.exec(name);
  if (!match) return null;
  const [row] = await db
    .select({ bytes: images.bytes, contentType: images.contentType })
    .from(images)
    .where(eq(images.id, match[1]!));
  return row ?? null;
}

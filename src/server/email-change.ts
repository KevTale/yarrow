/**
 * Changing a signed-in person's email: Yarrow mails a link to the new
 * address, and the link carries who asked, which address, and until when,
 * signed so it cannot be forged. Opening it (still signed in as that
 * person) proves the address and makes the change.
 */
const LIFETIME_MS = 24 * 60 * 60 * 1000;

interface Claim {
  userId: string;
  email: string;
  expiresAt: number;
}

const encoder = new TextEncoder();

async function signature(key: string, payload: string): Promise<string> {
  const hmac = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      hmac,
      encoder.encode(`yarrow-email-change:${payload}`),
    ),
  );
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const toBase64Url = (text: string) =>
  btoa(String.fromCharCode(...encoder.encode(text)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const fromBase64Url = (value: string) =>
  new TextDecoder().decode(
    Uint8Array.from(
      atob(value.replace(/-/g, "+").replace(/_/g, "/")),
      (char) => char.charCodeAt(0),
    ),
  );

export async function emailChangeToken(
  key: string,
  userId: string,
  email: string,
  now = Date.now(),
): Promise<string> {
  const payload = toBase64Url(
    JSON.stringify({ userId, email, expiresAt: now + LIFETIME_MS }),
  );
  return `${payload}.${await signature(key, payload)}`;
}

/** The claim inside a token, or null when forged, broken or expired. */
export async function readEmailChangeToken(
  key: string,
  token: string,
  now = Date.now(),
): Promise<Claim | null> {
  const [payload, signed] = token.split(".");
  if (!payload || !signed) return null;
  const expected = await signature(key, payload);
  if (expected.length !== signed.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++)
    diff |= expected.charCodeAt(i) ^ signed.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const claim = JSON.parse(fromBase64Url(payload)) as Claim;
    return claim.expiresAt > now ? claim : null;
  } catch {
    return null;
  }
}

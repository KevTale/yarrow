import { getCookie, setCookie } from "@tanstack/react-start/server";
import { isGuestSponsor } from "@/db/sponsors";
import { databaseConfigured, withDb } from "./db.server";
import { appEnv } from "./env.server";
import { hmacSha256Hex } from "./github/app";

/**
 * A sponsor who paid without an account is recognized in the browser they
 * paid from: an HttpOnly cookie holds their guest id, signed so it cannot be
 * forged. It only ever opens that guest's own sponsoring, never an account;
 * signing in (email link or GitHub) moves everything to the real account.
 */
const COOKIE = "yarrow_guest";
const YEAR = 365 * 24 * 60 * 60;

function secret(): string | null {
  return appEnv().TOKEN_ENCRYPTION_KEY ?? null;
}

const sign = (guestId: string, key: string) =>
  hmacSha256Hex(key, `yarrow-guest:${guestId}`);

/** Equal-length hex strings, compared in constant time. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The guest id this browser paid as, if its signature holds. */
export async function cookieGuestId(): Promise<string | null> {
  const key = secret();
  const value = getCookie(COOKIE);
  if (!key || !value) return null;
  const [guestId, signature] = value.split(".");
  if (!guestId || !signature) return null;
  return same(signature, await sign(guestId, key)) ? guestId : null;
}

/** The guest sponsor of this browser, while not yet claimed by an account. */
export async function currentGuest(): Promise<string | null> {
  const guestId = await cookieGuestId();
  if (!guestId || !databaseConfigured()) return null;
  return (await withDb((db) => isGuestSponsor(db, guestId))) ? guestId : null;
}

export async function rememberGuest(guestId: string): Promise<void> {
  const key = secret();
  if (!key) return;
  setCookie(COOKIE, `${guestId}.${await sign(guestId, key)}`, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: YEAR,
  });
}

export function forgetGuest(): void {
  setCookie(COOKIE, "", { path: "/", maxAge: 0 });
}

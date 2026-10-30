import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
}

export function checkPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  return timingSafeEqual(
    scryptSync(password, salt, 32),
    Buffer.from(hash, "hex"),
  );
}

const sign = (value, secret) =>
  createHmac("sha256", secret).update(value).digest("base64url");

/** The session cookie's value: the user's id and its signature. */
export function sessionValue(userId, secret) {
  const value = String(userId);
  return `${value}.${sign(value, secret)}`;
}

/** The signed-in user's id, or null when the cookie is missing or forged. */
export function readSession(cookie, secret) {
  if (!cookie) return null;
  const [value, mac] = cookie.split(".");
  if (!value || !mac) return null;
  const expected = Buffer.from(sign(value, secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return null;
  const id = Number(value);
  return Number.isInteger(id) ? id : null;
}

export function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([name, value]) => name && value !== undefined)
      .map(([name, value]) => [name, decodeURIComponent(value)]),
  );
}

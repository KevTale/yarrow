/**
 * Cloudflare Access sits in front of the admin Worker and signs every request
 * it lets through. The Worker checks that signature itself too: a request
 * that reached it any other way is refused.
 */

type Jwk = JsonWebKey & { kid: string };

let cachedKeys: { team: string; keys: Jwk[]; at: number } | null = null;

async function accessKeys(team: string, fresh: boolean): Promise<Jwk[]> {
  if (
    !fresh &&
    cachedKeys?.team === team &&
    Date.now() - cachedKeys.at < 3_600_000
  )
    return cachedKeys.keys;
  const response = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Access certs: ${response.status}`);
  const { keys } = (await response.json()) as { keys: Jwk[] };
  cachedKeys = { team, keys, at: Date.now() };
  return keys;
}

function base64url(part: string): Uint8Array<ArrayBuffer> {
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

const json = (part: string) =>
  JSON.parse(new TextDecoder().decode(base64url(part))) as Record<
    string,
    unknown
  >;

export type AccessCheck = {
  team: string;
  aud: string;
  email: string;
  now?: number;
  /** Tests hand their own keys; the Worker fetches the team's. */
  keys?: (fresh: boolean) => Promise<Jwk[]>;
};

/** True when the token is Access's, for this application and this email. */
export async function verifyAccessToken(
  token: string | null,
  check: AccessCheck,
): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [head, body, signature] = parts as [string, string, string];
  try {
    const header = json(head);
    if (header.alg !== "RS256" || typeof header.kid !== "string") return false;
    const keys = check.keys ?? ((fresh) => accessKeys(check.team, fresh));
    // A key Access rotated in since the last fetch: fetch once more.
    const jwk =
      (await keys(false)).find((key) => key.kid === header.kid) ??
      (await keys(true)).find((key) => key.kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      base64url(signature),
      new TextEncoder().encode(`${head}.${body}`),
    );
    if (!valid) return false;
    const claims = json(body);
    const now = (check.now ?? Date.now()) / 1000;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    return (
      claims.iss === `https://${check.team}` &&
      audiences.includes(check.aud) &&
      typeof claims.exp === "number" &&
      claims.exp > now &&
      (typeof claims.nbf !== "number" || claims.nbf <= now + 60) &&
      typeof claims.email === "string" &&
      claims.email.toLowerCase() === check.email.toLowerCase()
    );
  } catch {
    return false;
  }
}

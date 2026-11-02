/**
 * GitHub App authentication and a minimal REST client. Runtime-agnostic
 * (WebCrypto + fetch): used by the shop Worker, the brain Worker and tests.
 */

const API = "https://api.github.com";

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of array) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function pemBody(pem: string): Uint8Array<ArrayBuffer> {
  const base64 = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

/** DER length prefix. */
function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  while (length > 0) {
    bytes.unshift(length & 0xff);
    length >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

/**
 * GitHub issues PKCS#1 keys ("BEGIN RSA PRIVATE KEY"); WebCrypto only
 * imports PKCS#8. Wrap the PKCS#1 structure in a PKCS#8 PrivateKeyInfo.
 */
export function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
  const algorithm = [
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01,
    0x01, 0x05, 0x00,
  ];
  const version = [0x02, 0x01, 0x00];
  const octet = [0x04, ...derLength(pkcs1.length)];
  const inner = version.length + algorithm.length + octet.length + pkcs1.length;
  return Uint8Array.from([
    0x30,
    ...derLength(inner),
    ...version,
    ...algorithm,
    ...octet,
    ...pkcs1,
  ]);
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const normalized = pem.replace(/\\n/g, "\n");
  const der = pemBody(normalized);
  const pkcs8 = normalized.includes("BEGIN RSA PRIVATE KEY")
    ? pkcs1ToPkcs8(der)
    : der;
  return crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/** A 9-minute App JWT (GitHub allows 10), backdated 60 s for clock drift. */
export async function createAppJwt(
  appId: string,
  privateKeyPem: string,
  now = Date.now(),
): Promise<string> {
  const issuedAt = Math.floor(now / 1000) - 60;
  const encoder = new TextEncoder();
  const header = base64url(
    encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })),
  );
  const payload = base64url(
    encoder.encode(
      JSON.stringify({ iat: issuedAt, exp: issuedAt + 540, iss: appId }),
    ),
  );
  const key = await importPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64url(signature)}`;
}

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type Fetch = typeof fetch;

export class GitHubClient {
  constructor(
    private readonly token: string,
    // Wrapped: Workers reject fetch called as a method ("Illegal invocation").
    private readonly fetcher: Fetch = (input, init) => fetch(input, init),
  ) {}

  async request<T>(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await this.fetcher(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "yarrow",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new GitHubError(
        response.status,
        `GitHub ${method} ${path} failed (${response.status}): ${detail.slice(0, 300)}`,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

export interface AppCredentials {
  appId: string;
  privateKey: string;
}

export type TokenPermissions = Partial<
  Record<
    | "checks"
    | "contents"
    | "pull_requests"
    | "issues"
    | "metadata"
    | "workflows",
    "read" | "write"
  >
>;

/**
 * A short-lived installation token, optionally narrowed to some repositories
 * and permissions. Sandboxes only ever get `{ contents: "read" }` on one repo.
 */
export async function installationToken(
  credentials: AppCredentials,
  installationId: string,
  scope: { repositoryIds?: number[]; permissions?: TokenPermissions } = {},
  fetcher: Fetch = (input, init) => fetch(input, init),
): Promise<{ token: string; expiresAt: string }> {
  const jwt = await createAppJwt(credentials.appId, credentials.privateKey);
  const result = await new GitHubClient(jwt, fetcher).request<{
    token: string;
    expires_at: string;
  }>("POST", `/app/installations/${installationId}/access_tokens`, {
    ...(scope.repositoryIds ? { repository_ids: scope.repositoryIds } : {}),
    ...(scope.permissions ? { permissions: scope.permissions } : {}),
  });
  return { token: result.token, expiresAt: result.expires_at };
}

/** Constant-time comparison of two hex strings. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** HMAC-SHA256 hex digest, as used by GitHub and Linear webhooks. */
export async function hmacSha256Hex(
  secret: string,
  body: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Verifies `X-Hub-Signature-256: sha256=<hex>`. */
export async function verifyGitHubSignature(
  secret: string,
  body: string,
  header: string | null,
): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const expected = await hmacSha256Hex(secret, body);
  return safeEqual(expected, header.slice("sha256=".length));
}

export { safeEqual };

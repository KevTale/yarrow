/**
 * AES-256-GCM for tracker OAuth tokens at rest. The key is 32 random bytes,
 * base64 (TOKEN_ENCRYPTION_KEY). Output: base64(iv || ciphertext).
 */
async function importKey(keyBase64: string): Promise<CryptoKey> {
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = Uint8Array.from(atob(keyBase64), (char) => char.charCodeAt(0));
  } catch {
    raw = new Uint8Array();
  }
  if (raw.length !== 32)
    throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function encryptToken(
  keyBase64: string,
  plaintext: string,
): Promise<string> {
  const key = await importKey(keyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  const out = new Uint8Array(iv.length + ciphertext.length);
  out.set(iv);
  out.set(ciphertext, iv.length);
  return toBase64(out);
}

export async function decryptToken(
  keyBase64: string,
  encrypted: string,
): Promise<string> {
  const key = await importKey(keyBase64);
  const bytes = Uint8Array.from(atob(encrypted), (char) => char.charCodeAt(0));
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(0, 12) },
    key,
    bytes.slice(12),
  );
  return new TextDecoder().decode(plaintext);
}

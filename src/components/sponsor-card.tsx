export interface CardValue {
  anonymous: boolean;
  name: string;
  tagline: string;
  description: string;
  website: string;
  logo: string | null;
}

/** "acme.com" → "https://acme.com/"; empty → ""; anything odd → null. */
export function websiteAddress(input: string): string | null {
  const value = input.trim();
  if (!value) return "";
  const withScheme = /^https?:\/\//i.test(value)
    ? value.replace(/^http:/i, "https:")
    : `https://${value}`;
  try {
    const url = new URL(withScheme);
    return url.hostname.includes(".") ? url.toString() : null;
  } catch {
    return null;
  }
}

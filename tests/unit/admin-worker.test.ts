import { beforeAll, describe, expect, it, vi } from "vitest";
import { verifyAccessToken } from "../../workers/admin-access";
import admin, { fundingFromForm, type AdminEnv } from "../../workers/admin";
import { escape } from "../../workers/admin-page";

const team = "team.cloudflareaccess.com";
const aud = "app-aud";
const email = "founder@example.com";
let keys: { privateKey: CryptoKey; jwk: JsonWebKey & { kid: string } };

const b64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const part = (value: object) =>
  b64(new TextEncoder().encode(JSON.stringify(value)));

async function token(claims: Record<string, unknown> = {}, kid = "k1") {
  const head = part({ alg: "RS256", kid });
  const body = part({
    iss: `https://${team}`,
    aud: [aud],
    email,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  });
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keys.privateKey,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${b64(new Uint8Array(signature))}`;
}

const check = () => ({
  team,
  aud,
  email,
  keys: async () => [keys.jwk],
});

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  keys = { privateKey: pair.privateKey, jwk: { ...jwk, kid: "k1" } };
});

describe("Access token", () => {
  it("accepts Access's token for this app and this email", async () => {
    expect(await verifyAccessToken(await token(), check())).toBe(true);
    expect(
      await verifyAccessToken(
        await token({ email: "Founder@Example.com" }),
        check(),
      ),
    ).toBe(true);
  });

  it("refuses anything else", async () => {
    const refused = [
      null,
      "not.a.token",
      await token({ email: "someone@example.com" }),
      await token({ aud: ["another-app"] }),
      await token({ iss: "https://evil.cloudflareaccess.com" }),
      await token({ exp: Math.floor(Date.now() / 1000) - 10 }),
      await token({}, "unknown-key"),
    ];
    for (const value of refused)
      expect(await verifyAccessToken(value, check())).toBe(false);
    const good = await token();
    const [head, body] = good.split(".");
    const forged = `${head}.${body}x.${good.split(".")[2]}`;
    expect(await verifyAccessToken(forged, check())).toBe(false);
  });
});

describe("admin Worker", () => {
  const brain = {
    dailyFundings: vi.fn(async () => []),
    createDailyFunding: vi.fn(async () => "id"),
    updateDailyFunding: vi.fn(async () => {}),
    pauseDailyFunding: vi.fn(async () => {}),
    compute: vi.fn(async () => ({
      providers: [
        {
          provider: "anthropic",
          pause: {
            since: new Date("2026-10-11T12:00:00Z"),
            until: new Date("2026-10-11T12:30:00Z"),
            message: "Your credit balance is <too low>",
          },
          todayCents: 120,
          weekCents: 840,
          monthCents: 2010,
          exact: true,
        },
        {
          provider: "openai",
          pause: null,
          todayCents: 30,
          weekCents: 210,
          monthCents: 500,
          exact: false,
        },
      ],
      owedCents: { stripe: 500, direct: 1000, promo: 303 },
      absorbedCents: 7,
    })),
    resumeProvider: vi.fn(async () => {}),
  };
  const env = (access = true) =>
    ({
      BRAIN: brain,
      APP_URL: "https://yarrow.run",
      ADMIN_EMAIL: email,
      ...(access ? { ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: aud } : {}),
    }) as unknown as AdminEnv;

  it("answers 404 to anyone without Access, and lets local dev in", async () => {
    const response = await admin.fetch(
      new Request("https://admin.yarrow.run/"),
      env(),
    );
    expect(response.status).toBe(404);
    expect(brain.dailyFundings).not.toHaveBeenCalled();
    const remote = await admin.fetch(
      new Request("https://admin.yarrow.run/"),
      env(false),
    );
    expect(remote.status).toBe(404);
    const local = await admin.fetch(
      new Request("http://localhost:8788/"),
      env(false),
    );
    expect(local.status).toBe(200);
  });

  it("refuses a form posted from another site", async () => {
    const form = new FormData();
    form.set("name", "Totem");
    form.set("amount", "10");
    const response = await admin.fetch(
      new Request("http://localhost:8788/fundings", {
        method: "POST",
        body: form,
        headers: { origin: "https://evil.example" },
      }),
      env(false),
    );
    expect(response.status).toBe(403);
    expect(brain.createDailyFunding).not.toHaveBeenCalled();
  });

  it("creates a funding from the form, and refuses an invalid one", async () => {
    const post = (fields: Record<string, string>) => {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.set(key, value);
      return admin.fetch(
        new Request("http://localhost:8788/fundings", {
          method: "POST",
          body: form,
          headers: { origin: "http://localhost:8788" },
        }),
        env(false),
      );
    };
    const ok = await post({
      name: "Totem",
      description: "",
      website: "https://totem.game",
      amount: "12",
      logo: "",
      start: "now",
    });
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe("/");
    expect(brain.createDailyFunding).toHaveBeenCalledWith(
      {
        profile: {
          publicName: "Totem",
          tagline: null,
          description: null,
          websiteUrl: "https://totem.game",
          logo: undefined,
        },
        amountCents: 1200,
      },
      "now",
    );
    const bad = await post({ name: "T", amount: "0" });
    expect(bad.headers.get("location")).toMatch(/^\/\?error=/);
    expect(brain.createDailyFunding).toHaveBeenCalledTimes(1);
    await post({
      name: "Totem",
      website: "https://totem.game",
      amount: "12",
      from: "05:00",
      to: "09:30",
    });
    expect(brain.createDailyFunding).toHaveBeenLastCalledWith(
      expect.objectContaining({ windowStart: 300, windowEnd: 570 }),
      "scheduled",
    );
    const reversed = await post({
      name: "Totem",
      website: "https://totem.game",
      amount: "12",
      from: "18:00",
      to: "11:30",
    });
    expect(reversed.headers.get("location")).toMatch(/^\/\?error=/);
    expect(brain.createDailyFunding).toHaveBeenCalledTimes(2);
  });

  it("shows each provider's spend and pause, and resumes one", async () => {
    const page = await (
      await admin.fetch(new Request("http://localhost:8788/"), env(false))
    ).text();
    expect(page).toContain("Out of credit since Oct 11, 12:00 UTC");
    expect(page).toContain("Your credit balance is &lt;too low&gt;");
    expect(page).toContain("≈$0.30 today");
    expect(page).toContain("$18.03");
    expect(page).toContain('action="/providers/anthropic/resume"');
    expect(page).not.toContain('action="/providers/openai/resume"');
    const resume = (provider: string) =>
      admin.fetch(
        new Request(`http://localhost:8788/providers/${provider}/resume`, {
          method: "POST",
          headers: { origin: "http://localhost:8788" },
        }),
        env(false),
      );
    expect((await resume("anthropic")).status).toBe(303);
    expect(brain.resumeProvider).toHaveBeenCalledWith("anthropic");
    expect((await resume("stripe")).status).toBe(404);
  });

  it("reads amounts in dollars", () => {
    const form = new FormData();
    form.set("amount", "7.5");
    expect(fundingFromForm(form).amountCents).toBe(750);
  });

  it("escapes what it prints", () => {
    expect(escape(`<img src=x onerror="a">`)).toBe(
      "&lt;img src=x onerror=&quot;a&quot;&gt;",
    );
  });
});

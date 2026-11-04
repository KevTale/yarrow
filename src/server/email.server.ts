import { createClient } from "@supabase/supabase-js";
import { operatorStatement } from "@/core/company";
import { money } from "@/core/packs";
import { appEnv } from "./env.server";

/**
 * Yarrow's own emails go through Resend; sign-in links inside them are made
 * by Supabase Auth (admin API). Both are optional: without them, sign-in
 * falls back to Supabase's own email (see sign-in.server.ts).
 */
export function emailConfigured(): boolean {
  const env = appEnv();
  return Boolean(env.RESEND_API_KEY && env.SUPABASE_SECRET_KEY);
}

/** Supabase Auth with the secret key: links, email changes, deletions. */
export function supabaseAdmin() {
  const env = appEnv();
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * A one-time sign-in link for this address, to put in our own email. A new
 * address gets an account on the first click (Supabase then reports a
 * "signup" verification).
 */
export async function signInLink(email: string, next: string): Promise<string> {
  const env = appEnv();
  const { data, error } = await supabaseAdmin().auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${env.APP_URL}${next}` },
  });
  if (error || !data.properties)
    throw new Error(`Sign-in link not created: ${error?.message}`);
  const { hashed_token, verification_type } = data.properties;
  const params = new URLSearchParams({
    token_hash: hashed_token,
    type: verification_type,
    next,
  });
  return `${env.APP_URL}/auth/confirm?${params}`;
}

const escape = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!,
  );

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

export interface EmailContent {
  /** The inbox preview line. */
  preheader: string;
  title: string;
  paragraphs: string[];
  /** Shown larger, in the brand's pollen color (the sponsor's place). */
  highlight?: string;
  button: { label: string; url: string };
  note?: string;
}

/** Yarrow's email layout: tables and inline styles, for every inbox. */
export function renderEmail(content: EmailContent): {
  html: string;
  text: string;
} {
  const env = appEnv();
  const p = (text: string) =>
    `<p style="margin:0 0 14px;font:16px/1.6 ${FONT};color:#bdc1c9">${escape(text)}</p>`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${escape(content.title)}</title></head>
<body style="margin:0;padding:0;background:#0c0d0f">
<span style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;color:transparent">${escape(content.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0c0d0f"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px">
<tr><td style="padding:0 4px 28px"><a href="${env.APP_URL}" style="text-decoration:none"><img src="${env.APP_URL}/brand/yarrow-logo-on-dark.png" width="125" height="28" alt="yarrow" style="display:block;border:0;outline:none"></a></td></tr>
<tr><td style="background:#111215;border:1px solid #25282e;border-radius:14px;padding:32px 28px">
<h1 style="margin:0 0 16px;font:600 24px/1.3 ${FONT};color:#edeef0">${escape(content.title)}</h1>
${content.highlight ? `<p style="margin:0 0 16px;font:600 20px/1.4 ${FONT};color:#f2b544">${escape(content.highlight)}</p>` : ""}
${content.paragraphs.map(p).join("\n")}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 4px"><tr><td style="background:#f2b544;border-radius:10px"><a href="${escape(content.button.url)}" style="display:inline-block;padding:13px 22px;font:600 15px ${FONT};color:#141714;text-decoration:none">${escape(content.button.label)}</a></td></tr></table>
${content.note ? `<p style="margin:20px 0 0;font:13px/1.6 ${FONT};color:#8a909b">${escape(content.note)}</p>` : ""}
</td></tr>
<tr><td style="padding:24px 4px 0;font:12px/1.7 ${FONT};color:#6b717c">The best ticket harness for your product team · <a href="${env.APP_URL}" style="color:#8a909b">yarrow.run</a><br>${escape(operatorStatement)}</td></tr>
</table></td></tr></table>
</body></html>`;
  const text = [
    content.title,
    "",
    ...(content.highlight ? [content.highlight, ""] : []),
    ...content.paragraphs,
    "",
    `${content.button.label}: ${content.button.url}`,
    ...(content.note ? ["", content.note] : []),
    "",
    operatorStatement,
  ].join("\n");
  return { html, text };
}

async function send(to: string, subject: string, content: EmailContent) {
  const env = appEnv();
  const { html, text } = renderEmail(content);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM ?? "Yarrow <no-reply@yarrow.run>",
      // Replies reach a person (forwarded by Cloudflare Email Routing).
      reply_to: "contact@yarrow.run",
      to: [to],
      subject,
      html,
      text,
    }),
  });
  if (!response.ok)
    throw new Error(
      `Resend failed (${response.status}): ${(await response.text()).slice(0, 300)}`,
    );
}

/** The sign-in email, for the sign-in page. */
export async function sendSignInEmail(email: string, next: string) {
  await send(email, "Your Yarrow sign-in link", {
    preheader: "One click to sign in to Yarrow.",
    title: "Sign in to Yarrow",
    paragraphs: ["Use this button to sign in. It works once."],
    button: { label: "Sign in", url: await signInLink(email, next) },
    note: "The link expires in 24 hours. If you did not ask for it, you can ignore this email.",
  });
}

/** Thanks a sponsor for a payment, with their place on the boards. */
export async function sendThanks(input: {
  to: string;
  amountCents: number;
  todayRank: number | null;
  allRank: number | null;
  /** Where the button goes: a sign-in link for guests, the dashboard otherwise. */
  link: string;
  /** The link signs in (guests): say how long it lasts. */
  signsIn: boolean;
}): Promise<void> {
  const place = [
    input.todayRank ? `#${input.todayRank} today` : null,
    input.allRank ? `#${input.allRank} all time` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  await send(input.to, "Thanks for sponsoring Yarrow", {
    preheader: place
      ? `You are ${place} on the Yarrow leaderboard.`
      : "Your sponsoring is live.",
    title: "Thanks for sponsoring",
    highlight: place ? `You are ${place}` : undefined,
    paragraphs: [
      `Your ${money(input.amountCents)} pays for frontier AI on builders' tickets. Every pull request it funds carries your name.`,
    ],
    button: { label: "Open your dashboard", url: input.link },
    note: input.signsIn
      ? "The button signs you in on any device. It works once and expires in 24 hours; after that, sign in with this email on yarrow.run."
      : undefined,
  });
}

/** To the new address: one click confirms it. */
export async function sendEmailChangeLink(to: string, url: string) {
  await send(to, "Confirm your new Yarrow email", {
    preheader: "One click to use this address on Yarrow.",
    title: "Confirm your new email",
    paragraphs: [
      "You asked to sign in to Yarrow with this address. Confirm it, and it replaces the old one.",
    ],
    button: { label: "Confirm this email", url },
    note: "Open it in the browser where you are signed in. The link expires in 24 hours. If you did not ask for it, you can ignore this email.",
  });
}

/** To the old address, once the change is made. */
export async function sendEmailChangedNotice(to: string, email: string) {
  const env = appEnv();
  await send(to, "Your Yarrow email changed", {
    preheader: `Yarrow now uses ${email}.`,
    title: "Your email changed",
    paragraphs: [
      `Your Yarrow account now uses ${email}. If you did not make this change, reply to this email.`,
    ],
    button: { label: "Open your account", url: `${env.APP_URL}/account` },
  });
}

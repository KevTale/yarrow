import { createClient } from "@supabase/supabase-js";
import { money } from "@/core/packs";
import { appEnv } from "./env.server";

/**
 * Yarrow's own emails go through Resend; sign-in links inside them are made
 * by Supabase Auth (admin API). Both are optional: without them, the guest
 * gets Supabase's plain sign-in email instead (see sign-in.server.ts).
 */
export function emailConfigured(): boolean {
  const env = appEnv();
  return Boolean(env.RESEND_API_KEY && env.SUPABASE_SECRET_KEY);
}

/**
 * A one-time sign-in link for this address, to put in our own email. A new
 * address gets an account on the first click (Supabase then reports a
 * "signup" verification), like the sign-in page does.
 */
export async function signInLink(email: string, next: string): Promise<string> {
  const env = appEnv();
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.auth.admin.generateLink({
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

/** Thanks a sponsor for a payment, with their place on the boards. */
export async function sendThanks(input: {
  to: string;
  amountCents: number;
  todayRank: number | null;
  allRank: number | null;
  /** Where the button goes: a sign-in link for guests, the dashboard otherwise. */
  link: string;
}): Promise<void> {
  const env = appEnv();
  const place = [
    input.todayRank ? `#${input.todayRank} today` : null,
    input.allRank ? `#${input.allRank} all time` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const lines = [
    `Thanks for sponsoring Yarrow. Your ${money(input.amountCents)} pays for frontier AI on builders' tickets.`,
    place ? `You are ${place}.` : null,
  ].filter(Boolean) as string[];
  const html = `<!doctype html><html><body style="margin:0;background:#0c0d0f;color:#edeef0;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
<div style="max-width:480px;margin:0 auto;padding:40px 24px">
<p style="font-size:22px;font-weight:600;margin:0 0 20px">yarrow</p>
${lines.map((line) => `<p style="font-size:16px;line-height:1.6;margin:0 0 12px">${escape(line)}</p>`).join("")}
<p style="margin:28px 0"><a href="${escape(input.link)}" style="display:inline-block;background:#f2b544;color:#141714;font-weight:600;text-decoration:none;padding:12px 20px;border-radius:9px">Open your dashboard</a></p>
<p style="font-size:12px;color:#8a909b;line-height:1.6;margin:32px 0 0">TOTEM EURL · 1 avenue Galois, 92340 Bourg-la-Reine, France</p>
</div></body></html>`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM ?? "Yarrow <no-reply@yarrow.run>",
      to: [input.to],
      subject: "Thanks for sponsoring Yarrow",
      html,
      text: `${lines.join("\n")}\n\nOpen your dashboard: ${input.link}\n`,
    }),
  });
  if (!response.ok)
    throw new Error(
      `Resend failed (${response.status}): ${(await response.text()).slice(0, 300)}`,
    );
}

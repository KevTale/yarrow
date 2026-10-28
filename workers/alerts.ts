import { providerName, type Provider } from "../src/core/failures";
import { PAUSE_MINUTES } from "../src/db/pauses";

/**
 * Tells the founder that a provider ran out of credit, once per outage.
 * Optional: without RESEND_API_KEY or ALERT_EMAIL on the brain, the pause
 * only shows in the admin.
 */
export async function sendOutOfCreditAlert(
  env: { RESEND_API_KEY?: string; ALERT_EMAIL?: string; ADMIN_URL?: string },
  provider: Provider,
  message: string,
): Promise<void> {
  if (!env.RESEND_API_KEY || !env.ALERT_EMAIL) return;
  const name = providerName[provider];
  const text = [
    `Yarrow's ${name} account has no credit left. Dispatch is paused: tickets wait in the queue, nothing is abandoned.`,
    "",
    `Yarrow tries again every ${PAUSE_MINUTES} minutes. After topping up, Resume in the admin starts at once.`,
    ...(env.ADMIN_URL ? ["", env.ADMIN_URL] : []),
    "",
    `${name} said: ${message.slice(0, 400)}`,
  ].join("\n");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Yarrow <no-reply@yarrow.run>",
      to: [env.ALERT_EMAIL],
      subject: `${name} is out of credit: dispatch paused`,
      text,
    }),
  });
  if (!response.ok)
    throw new Error(
      `Resend failed (${response.status}): ${(await response.text()).slice(0, 300)}`,
    );
}

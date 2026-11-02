import { mkdirSync, writeFileSync } from "node:fs";

/**
 * Sends an email. MAIL_TRANSPORT=file writes it to outbox/ as HTML (open it
 * in a browser); "log", the default, prints it. Production uses "smtp",
 * which this demo does not ship.
 */
export async function sendMail({ to, subject, html, text }) {
  const transport = process.env.MAIL_TRANSPORT ?? "log";
  if (transport === "file") {
    const folder = new URL("../outbox/", import.meta.url);
    mkdirSync(folder, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${to}.html`;
    writeFileSync(new URL(name, folder), html);
    return { to, file: `outbox/${name}` };
  }
  if (transport === "log") {
    console.log(`To: ${to}\nSubject: ${subject}\n\n${text}\n`);
    return { to };
  }
  throw new Error(`Unknown MAIL_TRANSPORT "${transport}"`);
}

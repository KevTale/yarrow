import "../src/env.js";
import { digestEmail } from "../src/digest.js";
import { pool, tasksOf, usersWithDigest } from "../src/db.js";
import { sendMail } from "../src/mail.js";

// The Monday email: each person who wants it gets their open tasks.
const users = await usersWithDigest();
for (const user of users) {
  const email = digestEmail({ user, tasks: await tasksOf(user.id) });
  const sent = await sendMail({ to: user.email, ...email });
  console.log(`Sent "${email.subject}" to ${user.email}${sent.file ? ` (${sent.file})` : ""}`);
}
await pool.end();
console.log(`${users.length} digest${users.length === 1 ? "" : "s"} sent`);

import "../src/env.js";
import { hashPassword } from "../src/auth.js";
import { pool } from "../src/db.js";

// Starts over: the demo team, its tasks, and the demo user.
await pool.query("TRUNCATE tasks, users RESTART IDENTITY CASCADE");

const people = [
  ["demo@tally.dev", "Demo User", "demo1234"],
  ["lea@tally.dev", "Léa Martin", "unused-password"],
  ["sam@tally.dev", "Sam Okafor", "unused-password"],
];
for (const [email, name, password] of people)
  await pool.query(
    "INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)",
    [email, name, hashPassword(password)],
  );

const day = (offset) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const tasks = [
  ["Write the onboarding email", "doing", 1, day(1)],
  ["Fix the export to CSV", "doing", 2, day(0)],
  ["Plan the October release", "todo", 3, day(6)],
  ["Answer the pricing question from Acme", "todo", 1, day(-2)],
  ["Update the team page", "todo", null, day(12)],
  ["Review Sam's design for settings", "todo", 2, null],
  ["Renew the domain", "done", 3, day(-5)],
  ["Ship the new login page", "done", 1, day(-9)],
];
for (const [title, status, assignee, due] of tasks)
  await pool.query(
    "INSERT INTO tasks (title, status, assignee_id, due_on) VALUES ($1, $2, $3, $4)",
    [title, status, assignee, due],
  );

await pool.end();
console.log(`Seeded ${people.length} people and ${tasks.length} tasks`);

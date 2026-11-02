import "../src/env.js";
import { hashPassword } from "../src/auth.js";
import { pool } from "../src/db.js";

// Starts over: the demo team, its tasks and comments, and the demo user.
// --many adds a big team's backlog (3,000 tasks), to try the app at scale.
const many = process.argv.includes("--many");
await pool.query("TRUNCATE comments, tasks, users RESTART IDENTITY CASCADE");

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
// Title, status, assignee, due date, comments.
const tasks = [
  ["Write the onboarding email", "doing", 1, day(1), 2],
  ["Fix the export to CSV", "doing", 2, day(0), 4],
  ["Plan the October release", "todo", 3, day(6), 1],
  ["Answer the pricing question from Acme", "todo", 1, day(-2), 0],
  ["Update the team page", "todo", null, day(12), 0],
  ["Review Sam's design for settings", "todo", 2, null, 3],
  ["Renew the domain", "done", 3, day(-5), 0],
  ["Ship the new login page", "done", 1, day(-9), 5],
];
if (many)
  for (let index = 1; index <= 3000; index++)
    tasks.push([
      `Backlog item ${index}`,
      ["todo", "doing", "done"][index % 3],
      (index % 3) + 1,
      day((index % 60) - 20),
      index % 4,
    ]);

const notes = ["On it", "Can you take a look?", "Done on my side", "Blocked"];
for (const [title, status, assignee, due, comments] of tasks) {
  const { rows } = await pool.query(
    "INSERT INTO tasks (title, status, assignee_id, due_on) VALUES ($1, $2, $3, $4) RETURNING id",
    [title, status, assignee, due],
  );
  for (let index = 0; index < comments; index++)
    await pool.query(
      "INSERT INTO comments (task_id, author_id, body) VALUES ($1, $2, $3)",
      [rows[0].id, (index % 3) + 1, notes[index % notes.length]],
    );
}

await pool.end();
console.log(`Seeded ${people.length} people and ${tasks.length} tasks`);

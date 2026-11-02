import "../src/env.js";
import { readdirSync, readFileSync } from "node:fs";
import { pool } from "../src/db.js";

// Applies db/migrations/*.sql in order, each once, each in a transaction.
const folder = new URL("../db/migrations/", import.meta.url);
await pool.query(
  "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
);
const { rows } = await pool.query("SELECT name FROM schema_migrations");
const applied = new Set(rows.map((row) => row.name));
const pending = readdirSync(folder)
  .filter((name) => name.endsWith(".sql") && !applied.has(name))
  .sort();
for (const name of pending) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(readFileSync(new URL(name, folder), "utf8"));
    await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [
      name,
    ]);
    await client.query("COMMIT");
    console.log(`Applied ${name}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
await pool.end();
console.log(pending.length ? "Database up to date" : "Nothing to apply");

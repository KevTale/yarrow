import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: the environment is set another way.
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const folder = new URL("../db/migrations/", import.meta.url);
await pool.query(
  "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
);
const { rows } = await pool.query("SELECT name FROM schema_migrations");
const applied = new Set(rows.map((row) => row.name));
for (const name of readdirSync(folder).filter((file) => file.endsWith(".sql")).sort()) {
  if (applied.has(name)) continue;
  await pool.query("BEGIN");
  await pool.query(readFileSync(new URL(name, folder), "utf8"));
  await pool.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
  await pool.query("COMMIT");
  console.log(`Applied ${name}`);
}
await pool.end();
console.log("Database up to date");

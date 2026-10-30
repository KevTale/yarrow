import "../src/env.js";
import { readFileSync } from "node:fs";
import { pool } from "../src/db.js";

await pool.query(
  readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"),
);
await pool.end();
console.log("Tables ready");

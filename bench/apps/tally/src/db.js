import pg from "pg";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function userByEmail(email) {
  const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [
    email.trim().toLowerCase(),
  ]);
  return rows[0] ?? null;
}

export async function userById(id) {
  const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function listUsers() {
  const { rows } = await pool.query("SELECT id, name FROM users ORDER BY name");
  return rows;
}

export async function usersWithDigest() {
  const { rows } = await pool.query(
    "SELECT id, email, name FROM users WHERE weekly_digest ORDER BY id",
  );
  return rows;
}

const ORDER = `ORDER BY CASE tasks.status WHEN 'doing' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END,
              tasks.due_on NULLS LAST, tasks.id`;

export async function countComments(taskId) {
  const { rows } = await pool.query(
    "SELECT count(*)::int AS count FROM comments WHERE task_id = $1",
    [taskId],
  );
  return rows[0].count;
}

/** Every task, with its assignee's name and how many comments it has. */
export async function listTasks() {
  const { rows } = await pool.query(
    `SELECT tasks.id, tasks.title, tasks.status, tasks.due_on, users.name AS assignee
     FROM tasks LEFT JOIN users ON users.id = tasks.assignee_id
     ${ORDER}`,
  );
  for (const task of rows) task.comments = await countComments(task.id);
  return rows;
}

/** One person's tasks, for their digest. */
export async function tasksOf(userId) {
  const { rows } = await pool.query(
    `SELECT tasks.id, tasks.title, tasks.status, tasks.due_on
     FROM tasks WHERE assignee_id = $1
     ${ORDER}`,
    [userId],
  );
  return rows;
}

export async function addTask({ title, assigneeId, dueOn }) {
  await pool.query(
    "INSERT INTO tasks (title, assignee_id, due_on) VALUES ($1, $2, $3)",
    [title, assigneeId || null, dueOn || null],
  );
}

export async function updateSettings(id, { name, weeklyDigest }) {
  await pool.query(
    "UPDATE users SET name = $1, weekly_digest = $2 WHERE id = $3",
    [name, weeklyDigest, id],
  );
}

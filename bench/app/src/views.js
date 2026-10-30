const ENTITIES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const escape = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ENTITIES[char]);

export const STATUS = { todo: "To do", doing: "Doing", done: "Done" };

const DAY = 24 * 60 * 60 * 1000;
const dayStart = (date) =>
  Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());

/** "Today", "Tomorrow", "Overdue · Oct 3" or "Oct 20". */
export function formatDue(due, today = new Date()) {
  if (!due) return "";
  const date = due instanceof Date ? due : new Date(`${due}T00:00:00`);
  const days = Math.round((dayStart(date) - dayStart(today)) / DAY);
  const label = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 0) return `Overdue · ${label}`;
  return label;
}

function layout({ title, user, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · Tally</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="top">
  <a class="brand" href="/">Tally</a>
  ${
    user
      ? `<nav>
    <a href="/">Tasks</a>
    <a href="/settings">Settings</a>
    <form method="post" action="/logout"><button class="link">Sign out</button></form>
  </nav>`
      : ""
  }
</header>
<main>${body}</main>
</body>
</html>`;
}

export function loginPage({ error } = {}) {
  return layout({
    title: "Sign in",
    body: `<form class="card narrow" method="post" action="/login">
  <h1>Sign in</h1>
  ${error ? `<p class="error">${escape(error)}</p>` : ""}
  <label>Email <input name="email" type="email" autocomplete="username" required></label>
  <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
  <button class="primary">Sign in</button>
</form>`,
  });
}

export function tasksPage({ user, tasks, people, today = new Date() }) {
  const rows = tasks
    .map(
      (task) => `<tr>
    <td>${escape(task.title)}</td>
    <td><span class="status ${escape(task.status)}">${STATUS[task.status]}</span></td>
    <td>${escape(task.assignee ?? "Nobody")}</td>
    <td class="${formatDue(task.due_on, today).startsWith("Overdue") ? "late" : ""}">${escape(formatDue(task.due_on, today))}</td>
  </tr>`,
    )
    .join("\n");
  return layout({
    title: "Tasks",
    user,
    body: `<div class="head">
  <h1>Tasks</h1>
  <p class="muted">${tasks.filter((task) => task.status !== "done").length} open</p>
</div>
<table class="card">
  <thead><tr><th>Task</th><th>Status</th><th>Assignee</th><th>Due</th></tr></thead>
  <tbody>
${rows || `<tr><td colspan="4" class="muted">No tasks yet</td></tr>`}
  </tbody>
</table>
<form class="card add" method="post" action="/tasks">
  <input name="title" placeholder="New task" required maxlength="200">
  <select name="assigneeId">
    <option value="">Nobody</option>
    ${people.map((person) => `<option value="${person.id}">${escape(person.name)}</option>`).join("")}
  </select>
  <input name="dueOn" type="date">
  <button class="primary">Add</button>
</form>`,
  });
}

export function settingsPage({ user, saved }) {
  return layout({
    title: "Settings",
    user,
    body: `<form class="card narrow" method="post" action="/settings">
  <h1>Settings</h1>
  ${saved ? `<p class="notice">Saved</p>` : ""}
  <label>Name <input name="name" value="${escape(user.name)}" required maxlength="80"></label>
  <label>Email <input value="${escape(user.email)}" disabled></label>
  <button class="primary">Save</button>
</form>`,
  });
}

import "./env.js";
import express from "express";
import { fileURLToPath } from "node:url";
import {
  checkPassword,
  parseCookies,
  readSession,
  sessionValue,
} from "./auth.js";
import {
  addTask,
  listTasks,
  listUsers,
  updateSettings,
  userByEmail,
  userById,
} from "./db.js";
import { loginPage, settingsPage, tasksPage } from "./views.js";

const secret = process.env.SESSION_SECRET;
if (!secret) throw new Error("Set SESSION_SECRET (see .env.example)");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.static(fileURLToPath(new URL("../public", import.meta.url))));

// Who is signed in, from the session cookie.
app.use(async (req, _res, next) => {
  const id = readSession(parseCookies(req.headers.cookie).session, secret);
  req.user = id ? await userById(id) : null;
  next();
});

const signedIn = (req, res, next) =>
  req.user ? next() : res.redirect("/login");

app.get("/login", (_req, res) => res.send(loginPage()));

app.post("/login", async (req, res) => {
  const user = await userByEmail(req.body.email ?? "");
  if (!user || !checkPassword(req.body.password ?? "", user.password_hash))
    return res
      .status(401)
      .send(loginPage({ error: "Wrong email or password" }));
  res.cookie("session", sessionValue(user.id, secret), {
    httpOnly: true,
    sameSite: "lax",
  });
  res.redirect("/");
});

app.post("/logout", (_req, res) => {
  res.clearCookie("session");
  res.redirect("/login");
});

app.get("/", signedIn, async (req, res) => {
  const [tasks, people] = await Promise.all([listTasks(), listUsers()]);
  res.send(tasksPage({ user: req.user, tasks, people }));
});

app.post("/tasks", signedIn, async (req, res) => {
  const title = (req.body.title ?? "").trim();
  if (title)
    await addTask({
      title: title.slice(0, 200),
      assigneeId: Number(req.body.assigneeId) || null,
      dueOn: req.body.dueOn,
    });
  res.redirect("/");
});

app.get("/settings", signedIn, (req, res) =>
  res.send(settingsPage({ user: req.user, saved: req.query.saved === "1" })),
);

app.post("/settings", signedIn, async (req, res) => {
  const name = (req.body.name ?? "").trim() || req.user.name;
  await updateSettings(req.user.id, {
    name: name.slice(0, 80),
    weeklyDigest: req.body.weeklyDigest === "on",
  });
  res.redirect("/settings?saved=1");
});

app.get("/api/tasks", signedIn, async (_req, res) => {
  const tasks = await listTasks();
  res.json({
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      assignee: task.assignee,
    })),
  });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Tally on http://localhost:${port}`));

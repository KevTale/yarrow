import assert from "node:assert/strict";
import { test } from "node:test";
import { readSession, sessionValue } from "../src/auth.js";
import { escape, formatDue, settingsPage, tasksPage } from "../src/views.js";

const today = new Date(2026, 9, 15);

test("escapes what people type", () => {
  assert.equal(
    escape(`<b>"Tom" & 'Jerry'</b>`),
    "&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;",
  );
});

test("says when a task is due", () => {
  assert.equal(formatDue(new Date(2026, 9, 15), today), "Today");
  assert.equal(formatDue(new Date(2026, 9, 16), today), "Tomorrow");
  assert.equal(formatDue(new Date(2026, 9, 13), today), "Overdue · Oct 13");
  assert.equal(formatDue(new Date(2026, 9, 30), today), "Oct 30");
  assert.equal(formatDue(null, today), "");
});

test("lists tasks and counts the open ones", () => {
  const html = tasksPage({
    user: { name: "Demo" },
    people: [],
    today,
    tasks: [
      { title: "A", status: "todo", assignee: null, due_on: null },
      { title: "B", status: "done", assignee: "Léa", due_on: null },
    ],
  });
  assert.match(html, /1 open/);
  assert.match(html, /Nobody/);
});

test("the settings page keeps the name typed", () => {
  const html = settingsPage({
    user: { name: "Ann <3", email: "a@b.c" },
    saved: true,
  });
  assert.match(html, /value="Ann &lt;3"/);
  assert.match(html, /Saved/);
});

test("a session cookie cannot be forged", () => {
  const value = sessionValue(7, "secret");
  assert.equal(readSession(value, "secret"), 7);
  assert.equal(readSession(value.replace(/^7/, "8"), "secret"), null);
  assert.equal(readSession("7.nope", "secret"), null);
});

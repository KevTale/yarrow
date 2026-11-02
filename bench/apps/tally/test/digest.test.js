import assert from "node:assert/strict";
import { test } from "node:test";
import { digestEmail, dueLabel } from "../src/digest.js";

const today = new Date(2026, 9, 15);

test("the digest lists the open tasks only", () => {
  const email = digestEmail({
    user: { name: "Léa Martin" },
    today,
    tasks: [
      { title: "Plan <release>", status: "todo", due_on: "2026-10-20" },
      { title: "Renew", status: "done", due_on: null },
    ],
  });
  assert.equal(email.subject, "Your week in Tally: 1 open task");
  assert.match(email.html, /Hi Léa/);
  assert.match(email.html, /Plan &lt;release&gt;/);
  assert.doesNotMatch(email.html, /Renew/);
  assert.match(email.text, /- Plan <release> \(To do, Oct 20\)/);
});

test("the digest says when a task is due", () => {
  assert.equal(dueLabel("2026-10-13", today), "Overdue · Oct 13");
  assert.equal(dueLabel(null, today), "");
});

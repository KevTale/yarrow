import assert from "node:assert/strict";
import { test } from "node:test";
import { openai, stub } from "../src/llm.js";
import { readRecap, recap } from "../src/recap.js";
import { EXAMPLE } from "../src/views.js";

const answering = (text) => ({ name: "fake", complete: async () => text });

test("reads the model's recap, even around a code fence", async () => {
  const result = await recap(
    "Notes",
    answering('```json\n{"summary": " Ship on Nov 10. ", "actionItems": ["Update the notes", "", 3]}\n```'),
  );
  assert.deepEqual(result, { summary: "Ship on Nov 10.", actionItems: ["Update the notes"] });
});

test("refuses a recap without its parts", () => {
  assert.throws(() => readRecap('{"summary": "x"}'), /missing/);
  assert.throws(() => readRecap("Sorry, I can't"), /without a recap/);
});

test("refuses empty notes", async () => {
  await assert.rejects(recap("  ", answering("{}")), /Paste/);
});

test("the stub reads the notes' own tasks", async () => {
  const result = await recap(EXAMPLE, stub());
  assert.equal(result.summary, "Weekly product sync, Oct 27.");
  assert.deepEqual(result.actionItems, [
    "Sam will update the release notes by Friday.",
    "Priya to book the usability sessions with five customers before the 5th",
    "Léa sends the survey to the beta list tomorrow",
  ]);
});

test("asks OpenAI for JSON", async () => {
  let sent;
  const model = openai({
    key: "sk-test",
    model: "gpt-4o-mini",
    fetcher: async (url, init) => {
      sent = { url, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"s","actionItems":[]}' } }] }));
    },
  });
  assert.deepEqual(await recap("Notes", model), { summary: "s", actionItems: [] });
  assert.equal(sent.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(sent.body.response_format.type, "json_object");
});

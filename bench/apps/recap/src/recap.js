/**
 * A meeting's recap from its notes: a short summary and the action items,
 * written by a language model (src/llm.js).
 */

export const SYSTEM = `You write the recap of a meeting from its raw notes.
Answer with JSON only: {"summary": "...", "actionItems": ["..."]}.
- summary: two or three plain sentences: what was decided and why it matters.
- actionItems: each thing someone must do after the meeting, one short imperative sentence each, in the order of the notes. None when there is none.
Never invent what the notes do not say.`;

/** The model's answer, read; a malformed one throws. */
export function readRecap(text) {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error("The model answered without a recap");
  const data = JSON.parse(json);
  if (typeof data.summary !== "string" || !Array.isArray(data.actionItems))
    throw new Error("The model's recap is missing its summary or action items");
  return {
    summary: data.summary.trim(),
    actionItems: data.actionItems
      .filter((item) => typeof item === "string" && item.trim())
      .map((item) => item.trim()),
  };
}

/** The recap of `notes`, from `model` (src/llm.js). */
export async function recap(notes, model) {
  const text = notes.trim();
  if (!text) throw new Error("Paste the meeting's notes first");
  if (text.length > 20_000) throw new Error("Notes are limited to 20,000 characters");
  return readRecap(await model.complete({ system: SYSTEM, user: text }));
}

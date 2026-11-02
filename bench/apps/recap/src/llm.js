/**
 * The language model behind the recaps. With OPENAI_API_KEY, OpenAI's
 * chat completions (OPENAI_MODEL, gpt-4o-mini by default); without it, a
 * local stub that reads the notes' own lines, for development and tests.
 */

export function modelFromEnv(env = process.env) {
  return env.OPENAI_API_KEY
    ? openai({ key: env.OPENAI_API_KEY, model: env.OPENAI_MODEL || "gpt-4o-mini" })
    : stub();
}

export function openai({ key, model, fetcher = fetch }) {
  return {
    name: `openai:${model}`,
    async complete({ system, user }) {
      const response = await fetcher("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (!response.ok) throw new Error(`OpenAI answered ${response.status}`);
      const data = await response.json();
      return data.choices[0].message.content;
    },
  };
}

/**
 * No model: the first sentence of the notes is the summary, and each line
 * that reads like a task ("- [ ] …", "TODO …", "… will …") an action item.
 */
export function stub() {
  return {
    name: "stub",
    async complete({ user }) {
      const lines = user.split("\n").map((line) => line.trim()).filter(Boolean);
      const summary = (user.replace(/\s+/g, " ").match(/^.*?[.!?](\s|$)/)?.[0] ?? lines[0] ?? "").trim();
      const actionItems = lines
        .filter((line) => /^(- \[ \]|todo\b|action\b)|\bwill\b/i.test(line))
        .map((line) => line.replace(/^(- \[ \]|todo:?|action:?)\s*/i, ""));
      return JSON.stringify({ summary, actionItems });
    },
  };
}

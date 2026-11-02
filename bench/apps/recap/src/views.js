const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ENTITIES[char]);

export const EXAMPLE = `Weekly product sync, Oct 27. Léa, Sam, Priya.
We agreed to ship the new onboarding on Nov 10 instead of Nov 3, QA needs another week.
Sam will update the release notes by Friday.
- [ ] Priya to book the usability sessions with five customers before the 5th
Pricing page stays as it is until we have the survey results.
TODO: Léa sends the survey to the beta list tomorrow`;

export function page({ model, notes = "", result, error }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Recap</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #f7f7f4; color: #1f2420; font: 15px/1.55 system-ui, sans-serif; }
  main { max-width: 760px; margin: 40px auto; padding: 0 20px; display: grid; gap: 20px; }
  h1 { margin: 0; font-size: 24px; }
  .muted { color: #6d7470; }
  form, section { background: #fff; border: 1px solid #e3e5df; border-radius: 12px; padding: 20px; display: grid; gap: 12px; }
  textarea { font: inherit; width: 100%; min-height: 200px; padding: 12px; border: 1px solid #d6d9d2; border-radius: 8px; resize: vertical; }
  button { justify-self: start; font: inherit; font-weight: 600; padding: 9px 18px; border: 0; border-radius: 8px; background: #1f6f4a; color: #fff; cursor: pointer; }
  h2 { margin: 0; font-size: 16px; }
  ul { margin: 0; padding-left: 20px; }
  .error { color: #b3261e; margin: 0; }
  .example { font-size: 13px; }
</style>
</head>
<body>
<main>
  <div>
    <h1>Recap</h1>
    <p class="muted">Paste a meeting's notes: get what was decided and who does what next.</p>
  </div>
  <form method="post" action="/">
    <textarea name="notes" placeholder="${escape(EXAMPLE)}" required>${escape(notes)}</textarea>
    ${error ? `<p class="error">${escape(error)}</p>` : ""}
    <button>Write the recap</button>
  </form>
  ${
    result
      ? `<section>
    <h2>Summary</h2>
    <p>${escape(result.summary)}</p>
    <h2>Action items</h2>
    ${
      result.actionItems.length
        ? `<ul>${result.actionItems.map((item) => `<li>${escape(item)}</li>`).join("")}</ul>`
        : `<p class="muted">None</p>`
    }
  </section>`
      : ""
  }
  <p class="muted example">Model: ${escape(model)}</p>
</main>
</body>
</html>`;
}

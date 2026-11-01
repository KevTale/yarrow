import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown, Rich } from "../../src/components/markdown";

const line = (text: string) =>
  renderToStaticMarkup(createElement(Rich, { text }));

describe("Markdown as the agents and the tickets write it", () => {
  it("reads emphasis, nested, as GitHub does", () => {
    expect(line("_Opened from Yarrow by **KevTale**_")).toBe(
      "<em>Opened from Yarrow by <strong>KevTale</strong></em>",
    );
    expect(line("*a **b** c* and ~~old~~")).toBe(
      "<em>a <strong>b</strong> c</em> and <s>old</s>",
    );
    expect(line("__bold__ then *it*")).toBe(
      "<strong>bold</strong> then <em>it</em>",
    );
  });

  it("leaves code, words with underscores and lone stars alone", () => {
    expect(line("`a_b_c` and user_id_field, 2 * 3 * 4")).toBe(
      "<code>a_b_c</code> and user_id_field, 2 * 3 * 4",
    );
  });

  it("makes links of addresses, a sentence's last stop left out", () => {
    expect(line("See https://x.dev/a_b_c.")).toBe(
      'See <a class="rich-link" href="https://x.dev/a_b_c" target="_blank" rel="noopener">https://x.dev/a_b_c</a>.',
    );
    expect(line("[the **docs**](https://x.dev)")).toBe(
      '<a class="rich-link" href="https://x.dev" target="_blank" rel="noopener">the <strong>docs</strong></a>',
    );
  });

  it("reads blocks, each line through the reader it is given", () => {
    const html = renderToStaticMarkup(
      createElement(Markdown, {
        source: "Done:\n\n- the *filter*\n- the title\n\n_by **Marie**_",
        className: "pp-say",
      }),
    );
    expect(html).toBe(
      '<div class="md pp-say"><p>Done:</p><ul><li>the <em>filter</em></li><li>the title</li></ul><p><em>by <strong>Marie</strong></em></p></div>',
    );
    const shout = renderToStaticMarkup(
      createElement(Markdown, {
        source: "a\n\nb",
        inline: (text: string) => text.toUpperCase(),
      }),
    );
    expect(shout).toBe('<div class="md"><p>A</p><p>B</p></div>');
  });
});

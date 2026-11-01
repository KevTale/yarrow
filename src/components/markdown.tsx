import type { ReactNode } from "react";

/**
 * Markdown within a line: `code`, [links](https://…), a bare https://
 * address, **bold**, *italics* or _italics_, ~~struck~~; emphasis holds
 * the others. An underscore inside a word (snake_case) stays one.
 */
const inline = new RegExp(
  [
    /(`[^`\n]+`)/.source,
    /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/.source,
    /(https?:\/\/[^\s<>()`]+)/.source,
    /\*\*(?=\S)(.+?)(?<=\S)\*\*/.source,
    /(?<!\w)__(?=\S)(.+?)(?<=\S)__(?!\w)/.source,
    /~~(?=\S)(.+?)(?<=\S)~~/.source,
    /\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?!\*)/.source,
    /(?<!\w)_(?=[^\s_])(.+?)(?<=[^\s_])_(?!\w)/.source,
  ].join("|"),
  "g",
);

/** A link the agents wrote, opened in a new tab. */
function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="rich-link" href={href} target="_blank" rel="noopener">
      {children}
    </a>
  );
}

/** The agents and the tickets write Markdown: a line of it, read as such. */
export function Rich({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(inline)) {
    const [whole, code, label, href, address, bold, strong, struck, em, under] =
      match;
    if (match.index > last) parts.push(text.slice(last, match.index));
    last = match.index + whole.length;
    const key = parts.length;
    if (code) parts.push(<code key={key}>{code.slice(1, -1)}</code>);
    else if (label && href)
      parts.push(
        <External key={key} href={href}>
          <Rich text={label} />
        </External>,
      );
    else if (address) {
      // A sentence's last stop is not part of the address.
      const url = address.replace(/[.,;:!?'"]+$/, "");
      parts.push(
        <External key={key} href={url}>
          {url}
        </External>,
      );
      last -= address.length - url.length;
    } else if (struck)
      parts.push(
        <s key={key}>
          <Rich text={struck} />
        </s>,
      );
    else if (bold ?? strong)
      parts.push(
        <strong key={key}>
          <Rich text={(bold ?? strong)!} />
        </strong>,
      );
    else
      parts.push(
        <em key={key}>
          <Rich text={(em ?? under)!} />
        </em>,
      );
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; level: number; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string }
  | { kind: "hr" };

const bullet = /^\s*[-*+]\s+(?:\[[ xX]\]\s+)?/;
const numbered = /^\s*\d+[.)]\s+/;

/** The blocks of a ticket's Markdown: enough of it to read a ticket by. */
export function markdownBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]!); i++)
        code.push(lines[i]!);
      i++;
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        kind: "h",
        level: heading[1]!.length,
        text: heading[2]!.replace(/\s+#+\s*$/, ""),
      });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }
    for (const [kind, marker] of [
      ["ul", bullet],
      ["ol", numbered],
    ] as const)
      if (marker.test(line)) {
        const items: string[] = [];
        while (i < lines.length && marker.test(lines[i]!)) {
          let item = lines[i]!.replace(marker, "");
          // A wrapped item goes on, indented, on the next lines.
          for (i++; i < lines.length && /^\s{2,}\S/.test(lines[i]!); i++)
            item += ` ${lines[i]!.trim()}`;
          items.push(item);
        }
        blocks.push({ kind, items });
        break;
      }
    if (bullet.test(line) || numbered.test(line)) continue;
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]!); i++)
        quote.push(lines[i]!.replace(/^\s*>\s?/, ""));
      blocks.push({ kind: "quote", text: quote.join(" ") });
      continue;
    }
    const paragraph: string[] = [];
    for (
      ;
      i < lines.length &&
      lines[i]!.trim() &&
      !/^\s*(```|#{1,6}\s|>)/.test(lines[i]!) &&
      !bullet.test(lines[i]!) &&
      !numbered.test(lines[i]!);
      i++
    )
      paragraph.push(lines[i]!.trim());
    blocks.push({ kind: "p", text: paragraph.join(" ") });
  }
  return blocks;
}

const rich = (text: string) => <Rich text={text} />;

/**
 * A ticket's description, or what the agents wrote, read as Markdown: its
 * blocks here, each line's Markdown by `inline` (Rich, or the conversation's
 * own, which plays the film from a moment).
 */
export function Markdown({
  source,
  className,
  inline = rich,
}: {
  source: string;
  className?: string;
  inline?: (text: string) => ReactNode;
}) {
  return (
    <div className={className ? `md ${className}` : "md"}>
      {markdownBlocks(source).map((block, i) => {
        switch (block.kind) {
          case "h":
            return (
              <p key={i} className="md-h">
                {inline(block.text)}
              </p>
            );
          case "ul":
          case "ol": {
            const List = block.kind;
            return (
              <List key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{inline(item)}</li>
                ))}
              </List>
            );
          }
          case "quote":
            return <blockquote key={i}>{inline(block.text)}</blockquote>;
          case "code":
            return <pre key={i}>{block.text}</pre>;
          case "hr":
            return <hr key={i} />;
          default:
            return <p key={i}>{inline(block.text)}</p>;
        }
      })}
    </div>
  );
}

import { Fragment } from "react";
import { Rich } from "./run-activity";

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

/** A ticket's description, read as Markdown, links and code included. */
export function Markdown({ source }: { source: string }) {
  return (
    <div className="md">
      {markdownBlocks(source).map((block, i) => {
        switch (block.kind) {
          case "h":
            return (
              <p key={i} className="md-h">
                <Rich text={block.text} />
              </p>
            );
          case "ul":
          case "ol": {
            const List = block.kind;
            return (
              <List key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Rich text={item} />
                  </li>
                ))}
              </List>
            );
          }
          case "quote":
            return (
              <blockquote key={i}>
                <Rich text={block.text} />
              </blockquote>
            );
          case "code":
            return <pre key={i}>{block.text}</pre>;
          case "hr":
            return <hr key={i} />;
          default:
            return (
              <p key={i}>
                {block.text ? <Rich text={block.text} /> : <Fragment />}
              </p>
            );
        }
      })}
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import {
  changelog,
  HACKATHON_START,
  type Change,
  type ChangelogEntry,
} from "@/core/changelog";

export const Route = createFileRoute("/changelog")({
  head: () => ({
    meta: [
      { title: "Changelog · Yarrow" },
      {
        name: "description",
        content: "What shipped on Yarrow, day by day.",
      },
    ],
  }),
  component: Changelog,
});

const sections = [
  ["new", "New"],
  ["improved", "Improved"],
  ["fixed", "Fixed"],
] as const;

const day = (iso: string, month: "long" | "short") =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month,
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

/** After x.ai's changelog: the date held on the left, the day's notes on the right. */
function Changelog() {
  return (
    <main id="main" className="container changelog">
      <h1>Changelog</h1>
      {changelog
        .filter((entry) => entry.date >= HACKATHON_START)
        .map((entry) => (
          <Entry key={entry.date} entry={entry} />
        ))}
      <details className="cl-before">
        <summary className="cl-entry">
          <span className="cl-when">
            <time dateTime="2026-10">Oct 6 – 25, 2026</time>
          </span>
          <h2>
            Before the hackathon <ChevronDown size={22} aria-hidden="true" />
          </h2>
        </summary>
        {changelog
          .filter((entry) => entry.date < HACKATHON_START)
          .map((entry) => (
            <Entry key={entry.date} entry={entry} />
          ))}
      </details>
    </main>
  );
}

function Entry({ entry }: { entry: ChangelogEntry }) {
  return (
    <article className="cl-entry" aria-labelledby={`cl-${entry.date}`}>
      <div className="cl-when">
        <time dateTime={entry.date}>
          <span className="cl-long">{day(entry.date, "long")}</span>
          <span className="cl-short">{day(entry.date, "short")}</span>
        </time>
      </div>
      <div className="cl-body">
        <h2 id={`cl-${entry.date}`}>{entry.title}</h2>
        {sections.map(([key, label]) => {
          const items = entry[key];
          if (!items?.length) return null;
          return (
            <section key={key} className="cl-section">
              <h3>{label}</h3>
              <ul>
                {items.map((item) => (
                  <ChangeItem key={text(item)} item={item} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </article>
  );
}

const text = (item: Change) => (typeof item === "string" ? item : item.text);

function ChangeItem({ item }: { item: Change }) {
  if (typeof item === "string") return <li>{item}</li>;
  return (
    <li>
      {item.text} <span className="cl-tag">{item.tag}</span>
    </li>
  );
}

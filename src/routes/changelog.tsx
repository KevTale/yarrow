import { createFileRoute } from "@tanstack/react-router";
import { changelog, earlier, type Change } from "@/core/changelog";

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
      {changelog.map((entry) => (
        <article
          key={entry.date}
          className="cl-entry"
          aria-labelledby={`cl-${entry.date}`}
        >
          <h2 id={`cl-${entry.date}`} className="cl-when">
            <time dateTime={entry.date}>
              <span className="cl-long">{day(entry.date, "long")}</span>
              <span className="cl-short">{day(entry.date, "short")}</span>
            </time>
          </h2>
          <div className="cl-body">
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
      ))}
      <article className="cl-entry" aria-labelledby="cl-earlier">
        <h2 id="cl-earlier" className="cl-when">
          Earlier
        </h2>
        <div className="cl-body">
          <section className="cl-section">
            <ul>
              {earlier.map((item) => (
                <ChangeItem key={text(item)} item={item} />
              ))}
            </ul>
          </section>
        </div>
      </article>
    </main>
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

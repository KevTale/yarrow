import { ArrowRight } from "lucide-react";
import { useMemo, useState } from "react";
import { MorphSelect } from "@/components/arc/morph-select/morph-select";
import {
  parseTicketLink,
  ticketSources,
  type TicketLink,
  type TicketSource,
} from "@/core/ticket-link";

const dots: Record<TicketSource["id"], string> = {
  github: "#f5f0e3",
  jira: "#6aa6ff",
  linear: "#a79bff",
  trello: "#5fc3e4",
  gitlab: "#f0875a",
  azure: "#5d9cec",
};

/**
 * Code lives on GitHub: every source starts with the GitHub connection.
 * A Jira ticket then asks for Jira, on the dashboard.
 */
function connectUrl(
  source: TicketSource,
  link: Omit<TicketLink, "source">,
): string {
  const params = new URLSearchParams();
  if (source.id !== "github") params.set("source", source.id);
  if (link.repository) params.set("repository", link.repository);
  if (link.issue) params.set("issue", String(link.issue));
  if (link.site) params.set("site", link.site);
  if (link.ticket) params.set("ticket", link.ticket);
  const query = params.toString();
  return `/connect/github${query ? `?${query}` : ""}`;
}

/** The hero form: paste a ticket link. Connecting GitHub comes next. */
export function ShipForm({ jira = false }: { jira?: boolean }) {
  // Jira opens once its OAuth app is configured on this deployment.
  const available = (item: TicketSource) =>
    !item.soon && (item.id !== "jira" || jira);
  const [source, setSource] = useState<TicketSource>(ticketSources[0]!);
  const [value, setValue] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const items = useMemo(
    () =>
      ticketSources.map((item) => ({
        value: item.id,
        label: item.name,
        icon: (
          <span className="ship-dot" style={{ background: dots[item.id] }} />
        ),
        meta: available(item) ? undefined : "soon",
        disabled: !available(item),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `available` reads `jira` alone.
    [jira],
  );
  function submit(event: React.FormEvent) {
    event.preventDefault();
    setHint(null);
    if (!value.trim()) return document.getElementById("ship-url")?.focus();
    const link = parseTicketLink(value);
    if (link && !available(link.source))
      return setHint(`${link.source.name} is coming soon.`);
    if (!link || link.source.id !== source.id)
      return setHint(`This doesn't look like a ${source.name} link.`);
    setBusy(true);
    window.location.href = connectUrl(source, link);
  }

  return (
    <div className="ship">
      <form
        className="ship-input"
        onSubmit={submit}
        aria-label="Get a pull request"
      >
        {/* uiarc's morph select: the pill grows into the list. */}
        <div className="ship-source">
          <MorphSelect
            label="Source"
            hideLabel
            value={source.id}
            onValueChange={(id) => {
              setSource(ticketSources.find((item) => item.id === id)!);
              setHint(null);
            }}
            panelWidth={220}
            items={items}
          />
        </div>
        <input
          id="ship-url"
          value={value}
          placeholder={source.example}
          autoComplete="off"
          aria-label={`${source.name} link`}
          onChange={(event) => {
            setValue(event.target.value);
            const link = parseTicketLink(event.target.value);
            if (link && available(link.source)) setSource(link.source);
          }}
        />
        <button className="go" type="submit" aria-busy={busy}>
          {busy ? `Opening ${source.name}…` : "Get a pull request"}
          <i>
            <ArrowRight size={14} strokeWidth={2.2} />
          </i>
        </button>
      </form>
      {hint && <p className="ship-hint">{hint}</p>}
      {/* For visitors with no issue at hand, and against "one ticket at a
          time": the same connection, with nothing to paste. Jira passes
          its source, so a builder already on GitHub lands on the dashboard,
          where Jira connects. */}
      <p className="ship-alt">
        or{" "}
        <a
          href={
            source.id === "jira"
              ? "/connect/github?source=jira"
              : "/connect/github"
          }
        >
          connect your backlog
        </a>
      </p>
    </div>
  );
}

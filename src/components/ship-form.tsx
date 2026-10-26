import { ArrowRight, Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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

/** The next choosable source from `from`, walking `step` (±1). */
function nextSource(
  from: number,
  step: 1 | -1,
  available: (source: TicketSource) => boolean,
): number {
  const n = ticketSources.length;
  for (let i = 1; i <= n; i++) {
    const at = (from + step * i + n) % n;
    if (available(ticketSources[at]!)) return at;
  }
  return from;
}

/** The hero form: paste a ticket link. Connecting GitHub comes next. */
export function ShipForm({ jira = false }: { jira?: boolean }) {
  // Jira opens once its OAuth app is configured on this deployment.
  const available = (item: TicketSource) =>
    !item.soon && (item.id !== "jira" || jira);
  const [source, setSource] = useState<TicketSource>(ticketSources[0]!);
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!picker.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function choose(next: TicketSource) {
    if (!available(next)) return;
    setSource(next);
    setOpen(false);
    setHint(null);
  }
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
        <div className="ship-source" ref={picker}>
          <button
            type="button"
            className="ship-source-button"
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => {
              setFocus(ticketSources.indexOf(source));
              setOpen(!open);
            }}
            onKeyDown={(event) => {
              if (!open && ["ArrowDown", "Enter", " "].includes(event.key)) {
                event.preventDefault();
                setFocus(ticketSources.indexOf(source));
                setOpen(true);
              } else if (open && event.key === "ArrowDown") {
                event.preventDefault();
                setFocus(nextSource(focus, 1, available));
              } else if (open && event.key === "ArrowUp") {
                event.preventDefault();
                setFocus(nextSource(focus, -1, available));
              } else if (open && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                choose(ticketSources[focus]!);
              } else if (event.key === "Escape") setOpen(false);
            }}
          >
            <span
              className="ship-dot"
              style={{ background: dots[source.id] }}
            />
            {source.name}
            <ChevronDown size={13} />
          </button>
          {open && (
            <ul className="ship-source-list" role="listbox" aria-label="Source">
              {ticketSources.map((item, i) => (
                <li
                  key={item.id}
                  role="option"
                  aria-selected={item.id === source.id}
                  aria-disabled={!available(item)}
                  className={i === focus ? "focus" : undefined}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(item);
                  }}
                >
                  <span
                    className="ship-dot"
                    style={{ background: dots[item.id] }}
                  />
                  {item.name}
                  {!available(item) && <em>soon</em>}
                  {item.id === source.id && (
                    <Check size={13} className="ship-check" />
                  )}
                </li>
              ))}
            </ul>
          )}
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
    </div>
  );
}

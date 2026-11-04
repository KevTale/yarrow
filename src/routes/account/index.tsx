import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, FileText, Github, Mail, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { money } from "@/core/packs";
import {
  deleteAccountFn,
  disconnectTrackerFn,
  getAccountFn,
  invoiceUrlFn,
  requestEmailChangeFn,
} from "@/functions/account.functions";
import { BackArrow } from "@/components/back-arrow";
import { TrackerIcon } from "@/components/brand-icons";
import { SignInPrompt } from "@/components/email-sign-in";
import { Spinner } from "@/components/navigation-feedback";

export const Route = createFileRoute("/account/")({
  validateSearch: z.object({
    email: z.enum(["changed"]).optional(),
    error: z.string().max(200).optional(),
  }),
  loader: () => getAccountFn(),
  head: () => ({ meta: [{ title: "Account · Yarrow" }] }),
  component: AccountPage,
});

type Account = Extract<
  Awaited<ReturnType<typeof getAccountFn>>,
  { status: "ok" }
>;

function AccountPage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  if (data.status === "signed_out") return <SignInPrompt next="/account" />;
  return (
    <main id="main" className="container page-main st">
      <div className="st-head">
        <BackArrow size={22} />
        <h1>Account</h1>
      </div>
      {search.email === "changed" && (
        <p className="feedback feedback-success" role="status">
          Your email is now {data.email}.
        </p>
      )}
      {search.error && (
        <p className="feedback feedback-error" role="alert">
          {search.error}
        </p>
      )}
      <SignIn data={data} />
      <Connections data={data} />
      {data.payments.length > 0 && <Payments data={data} />}
      {data.canDelete && <DeleteAccount />}
    </main>
  );
}

function SignIn({ data }: { data: Account }) {
  const request = useServerFn(requestEmailChangeFn);
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const result = await request({ data: { email } });
      setSent(result.sent);
      setEditing(false);
    } catch (cause) {
      setError(
        cause instanceof Error && /already/i.test(cause.message)
          ? cause.message
          : "That email could not be used. Check it and try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="st-section">
      <h2>Sign-in</h2>
      <div className="st-cards">
        <div className="st-card-wrap">
          <div className="st-card">
            <span className="st-icon" aria-hidden="true">
              <Mail size={18} />
            </span>
            <span className="st-card-body">
              <strong>Email</strong>
              <span className="muted">{data.email ?? "None yet"}</span>
            </span>
            {data.canChangeEmail && !editing && (
              <button
                type="button"
                className="bd-btn bd-btn-line"
                onClick={() => {
                  setEditing(true);
                  setSent(null);
                }}
              >
                Change
              </button>
            )}
          </div>
          {editing && (
            <form className="ac-email" onSubmit={submit}>
              <input
                type="email"
                required
                autoFocus
                autoComplete="email"
                placeholder="you@company.com"
                aria-label="New email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <button
                type="submit"
                className="bd-btn bd-btn-amber"
                disabled={pending}
              >
                {pending ? <Spinner /> : "Send the link"}
              </button>
              <button
                type="button"
                className="bd-btn bd-btn-ghost"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
              {error && (
                <p className="feedback feedback-error" role="alert">
                  {error}
                </p>
              )}
            </form>
          )}
          {sent && (
            <p className="ac-sent" role="status">
              Check <b>{sent}</b>: the link there confirms it.
            </p>
          )}
        </div>
        {data.githubLogin && (
          <div className="st-card">
            <span className="st-icon" aria-hidden="true">
              <Github size={18} />
            </span>
            <span className="st-card-body">
              <strong>GitHub</strong>
              <span className="mono muted">@{data.githubLogin}</span>
            </span>
            <span className="st-state on">Connected</span>
          </div>
        )}
      </div>
    </section>
  );
}

const TRACKERS: Record<string, string> = {
  jira: "Jira",
  linear: "Linear",
  trello: "Trello",
};

function Connections({ data }: { data: Account }) {
  if (!data.githubLogin && data.connections.length === 0) return null;
  return (
    <section className="st-section">
      <h2>Connections</h2>
      <div className="st-cards">
        {data.githubLogin && (
          <div className="st-card">
            <span className="st-icon" aria-hidden="true">
              <Github size={18} />
            </span>
            <span className="st-card-body">
              <strong>GitHub App</strong>
              <span className="muted">Repositories</span>
            </span>
            <a
              className="bd-btn bd-btn-line"
              href="https://github.com/settings/installations"
              target="_blank"
              rel="noreferrer"
            >
              Manage
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          </div>
        )}
        {data.connections.map((connection) => (
          <Connection key={connection.id} connection={connection} />
        ))}
      </div>
    </section>
  );
}

function Connection({
  connection,
}: {
  connection: Account["connections"][number];
}) {
  const disconnect = useServerFn(disconnectTrackerFn);
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    setError("");
    setPending(true);
    try {
      const { result } = await disconnect({
        data: { connectionId: connection.id },
      });
      if (result === "busy") {
        setError("A ticket from it is at work.");
        setPending(false);
        return;
      }
      await router.invalidate();
    } catch {
      setError("It could not be disconnected. Try again in a moment.");
      setPending(false);
    }
  }

  return (
    <div className="st-card-wrap">
      <div className="st-card">
        <span className="st-icon" aria-hidden="true">
          <TrackerIcon tracker={connection.tracker} size={18} />
        </span>
        <span className="st-card-body">
          <strong>{TRACKERS[connection.tracker] ?? connection.tracker}</strong>
          <span className="mono muted">{connection.name}</span>
        </span>
        {asking ? (
          <>
            <button
              type="button"
              className="bd-btn bd-btn-ghost"
              onClick={() => {
                setAsking(false);
                setError("");
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="bd-btn ac-delete"
              disabled={pending}
              onClick={() => void confirm()}
            >
              {pending ? <Spinner /> : "Disconnect"}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="bd-btn bd-btn-line"
            onClick={() => setAsking(true)}
          >
            Disconnect
          </button>
        )}
      </div>
      {error && (
        <p className="st-remove-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const date = (at: string) =>
  new Date(at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

function Payments({ data }: { data: Account }) {
  const invoice = useServerFn(invoiceUrlFn);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function open(contributionId: string) {
    setError("");
    setOpening(contributionId);
    // Opened at once, filled when Stripe answers: popups need the click.
    const tab = window.open("", "_blank");
    try {
      const { url } = await invoice({ data: { contributionId } });
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    } catch (cause) {
      tab?.close();
      setError(
        cause instanceof Error ? cause.message : "The invoice could not open.",
      );
    } finally {
      setOpening(null);
    }
  }

  return (
    <section className="st-section">
      <h2>Payments</h2>
      <div className="st-cards">
        {data.payments.map((payment) => (
          <div className="st-card ac-pay" key={payment.id}>
            <span className="ac-date">{date(payment.createdAt)}</span>
            <span className="muted">
              {payment.source === "promo"
                ? "Founding credit"
                : payment.source === "direct"
                  ? "Direct"
                  : payment.paymentStatus === "refunded"
                    ? "Refunded"
                    : "Card"}
            </span>
            <span className="ac-amount">{money(payment.amountCents)}</span>
            {payment.invoice ? (
              <button
                type="button"
                className="bd-btn bd-btn-line"
                onClick={() => void open(payment.id)}
                disabled={opening === payment.id}
              >
                {opening === payment.id ? <Spinner /> : <FileText size={14} />}
                Invoice
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}
      </div>
      {error && (
        <p className="feedback feedback-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function DeleteAccount() {
  const remove = useServerFn(deleteAccountFn);
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (typed.trim().toLowerCase() !== "delete") return;
    setError("");
    setPending(true);
    try {
      await remove({ data: { confirm: "delete" } });
      // A full load: every cached page of the account goes with it.
      window.location.assign("/");
    } catch {
      setError("The account could not be deleted. Try again in a moment.");
      setPending(false);
    }
  }

  return (
    <section className="st-section">
      <h2>Delete</h2>
      <div className="st-cards">
        <div className="st-card-wrap ac-danger">
          <div className="st-card">
            <span className="st-icon" aria-hidden="true">
              <Trash2 size={18} />
            </span>
            <span className="st-card-body">
              <strong>Delete my account</strong>
              <span className="muted">
                Projects leave Yarrow. Payments and invoices are kept, as the
                law requires; your credit keeps funding, anonymously.
              </span>
            </span>
            {!asking && (
              <button
                type="button"
                className="bd-btn ac-delete"
                onClick={() => setAsking(true)}
              >
                Delete
              </button>
            )}
          </div>
          {asking && (
            <form className="ac-email" onSubmit={submit}>
              <input
                autoFocus
                autoComplete="off"
                placeholder="Type delete"
                aria-label="Type delete to confirm"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
              />
              <button
                type="submit"
                className="bd-btn ac-delete"
                disabled={pending || typed.trim().toLowerCase() !== "delete"}
              >
                {pending ? <Spinner /> : "Delete my account"}
              </button>
              <button
                type="button"
                className="bd-btn bd-btn-ghost"
                onClick={() => {
                  setAsking(false);
                  setTyped("");
                }}
              >
                Cancel
              </button>
              {error && (
                <p className="feedback feedback-error" role="alert">
                  {error}
                </p>
              )}
            </form>
          )}
        </div>
      </div>
      <p className="st-note">
        Yarrow keeps access to your repositories until you uninstall its app on{" "}
        <a
          className="text-link"
          href="https://github.com/settings/installations"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>
        .
      </p>
    </section>
  );
}

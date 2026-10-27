import { ArrowRight, Github } from "lucide-react";
import { MIN_AMOUNT_CENTS, money } from "@/core/packs";
import { Logo, SponsorName } from "@/components/boards";
import type { SponsorData } from "./sponsor";

/**
 * First visit of a signed-in account with no project and no sponsoring:
 * the two ways in, side by side, each with a small live picture of what
 * happens next.
 */
export function WelcomeView({ data }: { data: SponsorData }) {
  const today = data.standings.today;
  const top = Math.max(0, ...today.others);
  // What it takes to lead today's board, in whole dollars.
  const cents = Math.max(MIN_AMOUNT_CENTS, Math.ceil((top + 1) / 100) * 100);
  const rows = today.rows.filter((row) => !row.you).slice(0, 2);

  return (
    <div className="welcome">
      <h1>Welcome to Yarrow</h1>
      <div className="welcome-grid">
        <section className="welcome-card" aria-labelledby="welcome-builder">
          <span className="bd-label">Builder</span>
          <h2 id="welcome-builder">Pull requests on your tickets</h2>
          <p>Free for builders. Sponsors pay for the compute.</p>
          <div className="wf" aria-hidden="true">
            <div className="wf-ticket">
              <span className="mono">#12</span> Fix the login redirect
            </div>
            <div className="wf-step">
              <span className="wf-dot writing" /> Claude Opus 5.5 writes
            </div>
            <div className="wf-step">
              <span className="wf-dot reviewing" /> GPT Astra reviews
            </div>
            <div className="wf-pr">
              <span className="wf-dot done" /> Pull request #13
              <span className="mono">draft</span>
            </div>
          </div>
          <a className="go welcome-go" href="/connect/github">
            <Github size={16} /> Connect GitHub
            <i>
              <ArrowRight size={14} strokeWidth={2.2} />
            </i>
          </a>
        </section>

        <section className="welcome-card" aria-labelledby="welcome-sponsor">
          <span className="bd-label">Sponsor</span>
          <h2 id="welcome-sponsor">Your name on every pull request you fund</h2>
          <p>Ranked by money paid. Today resets at midnight UTC.</p>
          <ol className="wf-board" aria-hidden="true">
            <li className="wf-row you">
              <span className="wf-rank">1</span>
              <span className="board-logo small anonymous">+</span>
              <b>You</b>
              <span className="wf-amount">{money(cents, false)}</span>
            </li>
            {rows.map((row, i) => (
              <li className="wf-row" key={row.publicId}>
                <span className="wf-rank">{i + 2}</span>
                <Logo name={row.name} url={row.logoUrl} size="small" />
                <SponsorName name={row.name} />
                <span className="wf-amount">{money(row.paidCents, false)}</span>
              </li>
            ))}
            {rows.length === 0 && (
              <li className="wf-row open">
                <span className="wf-rank">2</span>
                <span className="board-logo small open">+</span>
                <span>Open spot</span>
                <span className="wf-amount">$10</span>
              </li>
            )}
          </ol>
          <a className="go welcome-go" href="/?edit=true#sponsors">
            Take #1 today for {money(cents, false)}
            <i>
              <ArrowRight size={14} strokeWidth={2.2} />
            </i>
          </a>
        </section>
      </div>
    </div>
  );
}

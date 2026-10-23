import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Eye,
  GitPullRequest,
  ScanSearch,
  ShieldCheck,
  Tag,
  Zap,
} from "lucide-react";
import { money, packs } from "@/core/packs";
import { getHomeFn } from "@/functions/public.functions";
import {
  EmptyState,
  initials,
  RunStatus,
  SponsorLine,
  StatGrid,
  timeAgo,
  VisibilityBadge,
} from "@/components/ui";

export const Route = createFileRoute("/")({
  loader: () => getHomeFn(),
  component: Landing,
});

function Landing() {
  const home = Route.useLoaderData();
  return (
    <main id="main">
      <section className="hero">
        <div className="hero-grid" aria-hidden="true" />
        <div className="container hero-content">
          <div className="hero-copy">
            <p className="hero-kicker">
              <span className="live-dot" /> AI COMPUTE, FUNDED BY SPONSORS
            </p>
            <h1>
              Fund the compute.
              <br />
              <span>Ship the PR.</span>
            </h1>
            <p className="hero-description">
              Builders tag tickets. Sponsors fund the compute.
              <br />
              Every ticket comes back as a reviewed pull request.
            </p>
            <p className="hero-explanation">
              Claude implements, OpenAI reviews, and every PR carries the names
              of the sponsors who paid for it. Free for builders.
            </p>
            <div className="hero-actions">
              <Link to="/fund" className="button button-primary">
                Fund AI work <ArrowUpRight size={17} />
              </Link>
              <Link to="/projects/new" className="button button-secondary">
                Add a project <ArrowRight size={16} />
              </Link>
            </div>
            <p className="hero-footnote mono">
              From $10 <span>·</span> GitHub, Linear, Jira, Trello{" "}
              <span>·</span> Free for builders
            </p>
          </div>
          <div className="terminal" aria-label="How a ticket ships">
            <p className="terminal-title mono">agent-commons · run</p>
            <ol className="timeline mono">
              <li>
                <Tag size={14} /> ticket tagged <b>agent-commons</b>
              </li>
              <li>
                <Zap size={14} /> sponsor money reserved, oldest first
              </li>
              <li>
                <GitPullRequest size={14} /> Claude Opus 5.5 implements, runs
                the tests
              </li>
              <li>
                <ScanSearch size={14} /> OpenAI Astra reviews, one fix round
              </li>
              <li>
                <Eye size={14} /> screenshots &amp; video when the UI changes
              </li>
              <li className="amber">
                <Check size={14} /> draft PR · “Sponsored by …”
              </li>
            </ol>
          </div>
        </div>
      </section>

      <section className="totals-band" aria-label="Platform totals">
        <div className="container">
          {home.configured ? (
            <StatGrid
              items={[
                {
                  label: "Compute consumed",
                  value: money(home.stats.consumedCents, false),
                  detail: "Sponsor money turned into work",
                },
                {
                  label: "Pull requests delivered",
                  value:
                    home.stats.deliveredPullRequests.toLocaleString("en-US"),
                  detail: "Implemented, tested, reviewed",
                },
                {
                  label: "Merged",
                  value: home.stats.mergedPullRequests.toLocaleString("en-US"),
                  detail: "Accepted by the builders",
                },
                {
                  label: "Builders",
                  value: home.stats.projects.toLocaleString("en-US"),
                  detail: `${home.stats.sponsors} sponsor${home.stats.sponsors === 1 ? "" : "s"} behind them`,
                },
              ]}
            />
          ) : (
            <p className="muted small">
              Live totals appear once the database is connected.
            </p>
          )}
        </div>
      </section>

      <section className="container section how-section" aria-labelledby="how">
        <div className="section-heading">
          <div>
            <p className="eyebrow">TWO SIDES, ONE ENGINE</p>
            <h2 id="how">Tickets in. Reviewed pull requests out.</h2>
          </div>
          <span className="mono small muted">ticket → compute → PR</span>
        </div>
        <ol className="how-grid">
          {[
            {
              icon: Tag,
              title: "Builders tag tickets",
              description:
                "Connect a repo and GitHub Issues, Linear, Jira or Trello. Tagged tickets join the queue. Free.",
            },
            {
              icon: Zap,
              title: "Sponsors fund the compute",
              description:
                "Packs from $10, used in fair rotation across builders. Filter by category, stack or project.",
            },
            {
              icon: GitPullRequest,
              title: "A PR readable in two minutes",
              description:
                "Implemented by Claude, reviewed by OpenAI, tested, with screenshots. Or a clear reason why not.",
            },
          ].map((item, i) => (
            <li key={item.title}>
              <div className="row spread">
                <span className="step-number mono">0{i + 1}</span>
                <item.icon size={21} strokeWidth={1.5} />
              </div>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="container section ecosystem-grid">
        <div>
          <div className="section-heading">
            <div>
              <p className="eyebrow">SHIPPED LATELY</p>
              <h2>Work in motion</h2>
            </div>
            <Link to="/work" className="text-link">
              All work <ArrowUpRight size={14} />
            </Link>
          </div>
          {home.configured && home.feed.length > 0 ? (
            <div className="project-list">
              {home.feed.map((run) => (
                <Link
                  to="/runs/$runId"
                  params={{ runId: run.runId }}
                  key={run.runId}
                  className="project-row"
                >
                  <span className="project-info">
                    <strong>{run.ticketTitle}</strong>
                    <span>
                      {run.projectName} · {timeAgo(run.createdAt)}
                    </span>
                    <SponsorLine sponsors={run.sponsors} />
                  </span>
                  <RunStatus run={run} />
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState title="The first runs are on their way">
              Add a project or fund the pool to get things moving.
            </EmptyState>
          )}
        </div>
        <div>
          <div className="section-heading">
            <div>
              <p className="eyebrow">THE PEOPLE BEHIND THE COMPUTE</p>
              <h2>Top sponsors</h2>
            </div>
            <Link to="/leaderboard" className="text-link">
              Full board <ArrowUpRight size={14} />
            </Link>
          </div>
          {home.configured && home.leaders.length > 0 ? (
            <ol className="funder-list">
              {home.leaders.map((leader, i) => (
                <li key={`${leader.name}-${i}`}>
                  <span className={`mono rank ${i === 0 ? "amber" : ""}`}>
                    0{i + 1}
                  </span>
                  <span className="avatar">{initials(leader.name ?? "?")}</span>
                  <span>{leader.name}</span>
                  <strong className="mono">
                    {money(leader.consumedCents, false)}
                  </strong>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState title="The board is open">
              The first sponsor takes the top spot.
            </EmptyState>
          )}
          <p className="small muted section-note">
            Ranked by compute consumed, never by promises.
          </p>
        </div>
      </section>

      {home.configured && home.projects.length > 0 && (
        <section className="container section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">BUILDERS</p>
              <h2>Projects getting help</h2>
            </div>
            <Link to="/showcase" className="text-link">
              Showcase <ArrowUpRight size={14} />
            </Link>
          </div>
          <div className="project-list">
            {home.projects.map((project, i) => (
              <div key={project.id} className="project-row">
                <span
                  className={`project-icon project-icon-${i % 4}`}
                  aria-hidden="true"
                >
                  {project.name.charAt(0).toUpperCase()}
                </span>
                <span className="project-info">
                  <strong>{project.name}</strong>
                  <span>
                    {project.description || project.categories.join(" · ")}
                  </span>
                </span>
                <VisibilityBadge visibility={project.visibility} />
                <span className="project-amount mono">
                  {project.shipped} PR{project.shipped === 1 ? "" : "s"}
                  <small>{project.queued} queued</small>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="container section" aria-labelledby="packs">
        <div className="section-heading">
          <div>
            <p className="eyebrow">SPONSOR THE WORK</p>
            <h2 id="packs">Pick your starting point.</h2>
          </div>
          <span className="small muted">USD · one-time · or any amount</span>
        </div>
        <div className="landing-packs">
          {packs.map((pack) => (
            <Link
              to="/fund"
              search={{ amount: pack.amountCents / 100 }}
              key={pack.id}
              className={`landing-pack ${pack.id === "builder" ? "featured" : ""}`}
            >
              <div className="row spread">
                <span>{pack.name}</span>
                {pack.id === "builder" && (
                  <span className="eyebrow amber">A good place to start</span>
                )}
              </div>
              <div className="pack-price mono">
                {money(pack.amountCents, false)}
                <ArrowUpRight size={22} strokeWidth={1.5} />
              </div>
              <p>{pack.description}</p>
            </Link>
          ))}
        </div>
        <p className="pack-note">
          <Check size={14} /> Your name on every PR you fund <Check size={14} />{" "}
          Exclude categories or pick projects <Check size={14} /> A ledger for
          every cent
        </p>
      </section>

      <section className="container final-cta">
        <div>
          <p className="eyebrow amber">
            <ShieldCheck size={13} /> READ-ONLY CODE ACCESS · PRS ONLY WHERE YOU
            TAG
          </p>
          <h2>
            Your backlog,
            <br />
            shipped while you sleep.
          </h2>
        </div>
        <div>
          <Link to="/projects/new" className="button button-primary">
            Add a project <ArrowUpRight size={17} />
          </Link>
          <Link to="/fund" className="text-link">
            Or sponsor the builders <ArrowRight size={15} />
          </Link>
        </div>
      </section>
    </main>
  );
}

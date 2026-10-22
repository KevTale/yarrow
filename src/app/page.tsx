import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  GitPullRequest,
  Layers3,
  Zap,
} from "lucide-react";
import { DemoNotice, PoolBadge, StatGrid } from "@/components/ui";
import { WorkPreview } from "@/components/work-preview";
import { demoFunders, demoProjects } from "@/lib/demo-data";
import { money, packs } from "@/core/packs";

export default function HomePage() {
  return (
    <main id="main">
      <section className="hero">
        <div className="hero-grid" aria-hidden="true" />
        <div className="container hero-content">
          <div className="hero-copy">
            <p className="hero-kicker">
              <span className="live-dot" /> A COMMON GROUND FOR AI WORK
            </p>
            <h1>
              Fund the compute.
              <br />
              <span>Ship the PR.</span>
            </h1>
            <p className="hero-description">
              Good software takes work. <br />
              Help agents do more of it.
            </p>
            <p className="hero-explanation">
              Turn GitHub issues and Jira tickets into pull requests. Fund the
              compute. Follow every dollar.
            </p>
            <div className="hero-actions">
              <Link href="/fund" className="button button-primary">
                Fund AI work <ArrowUpRight size={17} />
              </Link>
              <Link href="/projects/new" className="button button-secondary">
                Add a project <ArrowRight size={16} />
              </Link>
            </div>
            <p className="hero-footnote mono">
              From $5 <span>·</span> One-time funding <span>·</span> No
              subscription
            </p>
          </div>
          <WorkPreview />
        </div>
        <div className="container">
          <DemoNotice />
        </div>
      </section>
      <section className="totals-band" aria-label="Example platform totals">
        <div className="container">
          <StatGrid
            items={[
              {
                label: "Dollars funded",
                value: "$412,880",
                detail: "Real work starts with a contribution",
              },
              {
                label: "Work units completed",
                value: "18,402",
                detail: "GitHub Issues + Jira",
              },
              {
                label: "Pull requests merged",
                value: "6,117",
                detail: "Reviewed by real maintainers",
              },
              {
                label: "Abstention rate",
                value: (
                  <>
                    23<span className="muted">%</span>
                  </>
                ),
                detail: "Knowing when to stop is part of it",
              },
            ]}
          />
        </div>
      </section>
      <section className="container section how-section" aria-labelledby="how">
        <div className="section-heading">
          <div>
            <p className="eyebrow">A SHORT PATH FROM INTENT TO IMPACT</p>
            <h2 id="how">Three steps. A visible outcome.</h2>
          </div>
          <span className="mono small muted">
            contribution → compute → code
          </span>
        </div>
        <ol className="how-grid">
          {[
            {
              icon: Zap,
              title: "Fund the work",
              description:
                "Choose a pack. Your contribution becomes API compute credit in a dedicated pool.",
            },
            {
              icon: Layers3,
              title: "Let agents pick it up",
              description:
                "Authorized issues become work units. A budget is reserved before any agent starts.",
            },
            {
              icon: GitPullRequest,
              title: "Get a PR. Or a reason.",
              description:
                "A pull request with evidence, or a documented abstention. Unused credit stays in the pool.",
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
              <p className="eyebrow">BUILT IN THE OPEN. AND BEYOND.</p>
              <h2>Projects in motion</h2>
            </div>
            <Link href="/work" className="text-link">
              Explore <ArrowUpRight size={14} />
            </Link>
          </div>
          <div className="project-list">
            {demoProjects.map((project, i) => (
              <Link
                href={`/work?pool=${project.pool}`}
                key={project.id}
                className="project-row"
              >
                <span
                  className={`project-icon project-icon-${i}`}
                  aria-hidden="true"
                >
                  {["≈", "H", "▱", "K"][i]}
                </span>
                <span className="project-info">
                  <strong>{project.name}</strong>
                  <span>{project.description}</span>
                </span>
                <PoolBadge pool={project.pool} />
                <span className="project-amount mono">
                  {money(project.fundedCents, false)}
                  <small>{project.queued} queued</small>
                </span>
              </Link>
            ))}
          </div>
          <p className="small muted section-note">
            Commons and commercial. Same engine, separate pools.
          </p>
        </div>
        <div>
          <div className="section-heading">
            <div>
              <p className="eyebrow">THE PEOPLE BEHIND THE COMPUTE</p>
              <h2>Top funders</h2>
            </div>
            <Link href="/leaderboard" className="text-link">
              Full board <ArrowUpRight size={14} />
            </Link>
          </div>
          <ol className="funder-list">
            {demoFunders.slice(0, 5).map((funder, i) => (
              <li key={funder.name}>
                <span className={`mono rank ${i === 0 ? "amber" : ""}`}>
                  0{i + 1}
                </span>
                <span className="avatar">{funder.initials}</span>
                <span>{funder.name}</span>
                <strong className="mono">
                  {money(funder.fundedCents, false)}
                </strong>
              </li>
            ))}
          </ol>
          <p className="small muted section-note">
            Ranked by dollars funded. Never by hype.
          </p>
        </div>
      </section>
      <section className="container section" aria-labelledby="packs">
        <div className="section-heading">
          <div>
            <p className="eyebrow">SMALL CONTRIBUTIONS. REAL MOMENTUM.</p>
            <h2 id="packs">Pick your starting point.</h2>
          </div>
          <span className="small muted">USD · one-time packs</span>
        </div>
        <div className="landing-packs">
          {packs.map((pack) => (
            <Link
              href={`/fund?pack=${pack.id}`}
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
          <Check size={14} /> No recurring charge <Check size={14} />{" "}
          Non-withdrawable compute credit <Check size={14} /> A ledger for every
          cent
        </p>
      </section>
      <section className="container final-cta">
        <div>
          <p className="eyebrow amber">ONE ACCOUNT. TWO WAYS TO CONTRIBUTE.</p>
          <h2>
            The next good thing
            <br />
            could start with you.
          </h2>
        </div>
        <div>
          <Link href="/fund" className="button button-primary">
            Fund AI work <ArrowUpRight size={17} />
          </Link>
          <Link href="/projects/new" className="text-link">
            Have a backlog? Add a project <ArrowRight size={15} />
          </Link>
        </div>
      </section>
    </main>
  );
}

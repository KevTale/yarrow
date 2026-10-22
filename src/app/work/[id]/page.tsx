import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, GitPullRequest, Pause, ArrowLeft } from "lucide-react";
import { DemoNotice, PoolBadge, StatusBadge } from "@/components/ui";
import { demoWork } from "@/lib/demo-data";
import { money } from "@/core/packs";

export function generateStaticParams() {
  return demoWork.map((work) => ({ id: work.id }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return {
    title: demoWork.find((work) => work.id === id)?.title ?? "Work not found",
  };
}
export default async function WorkDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const work = demoWork.find((item) => item.id === id);
  if (!work) notFound();
  const abstained = work.status === "Abstained";
  const running = work.status === "Running";
  const finished = !running;
  const timeline = abstained
    ? [
        {
          title: "Intake & scope",
          detail: "Read the issue and reviewed the project boundaries.",
          cost: work.costCents,
          state: "done",
        },
        {
          title: "Documented abstention",
          detail: work.reason,
          cost: 0,
          state: "abstained",
        },
      ]
    : [
        {
          title: "Plan",
          detail: "Scoped a bounded change and identified a regression test.",
          cost: Math.floor(work.costCents * 0.15),
          state: "done",
        },
        {
          title: "Patch",
          detail: "Prepared an isolated branch and a candidate change.",
          cost: Math.floor(work.costCents * 0.55),
          state: "done",
        },
        {
          title: running ? "Tests in progress" : "Validate & deliver",
          detail: running
            ? "The example run is checking the change against the test suite."
            : "Tests passed. Evidence attached to the draft pull request.",
          cost:
            work.costCents -
            Math.floor(work.costCents * 0.15) -
            Math.floor(work.costCents * 0.55),
          state: "done",
        },
      ];
  return (
    <main id="main" className="container page-main">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/work">Work ledger</Link>
        <span>/</span>
        <span aria-current="page" className="mono">
          {work.id}
        </span>
      </nav>
      <div className="row">
        <PoolBadge pool={work.pool} />
        <span className="mono small muted">
          {work.source} · {work.project} {work.issue}
        </span>
      </div>
      <h1 className="detail-title">{work.title}</h1>
      <p className="detail-intro">
        A bounded work unit, its execution trail, and every cent behind the
        outcome.
      </p>
      <div style={{ marginTop: 17 }}>
        <DemoNotice>
          Sample work unit · the PR, evidence and timeline below are
          illustrative.
        </DemoNotice>
      </div>
      <section
        className={`outcome-panel ${abstained ? "abstained" : !running ? "success" : ""}`}
        aria-label="Work outcome"
      >
        <span className="outcome-icon">
          {abstained ? <Pause size={21} /> : <GitPullRequest size={21} />}
        </span>
        <div>
          <h2>
            {abstained
              ? "Abstained. With a reason."
              : running
                ? "Work is in progress."
                : `Pull request ${work.pr} ${work.status === "Merged" ? "merged" : "opened"}.`}
          </h2>
          <p>
            {abstained
              ? work.reason
              : running
                ? "A PR or an explicit abstention will close this work unit."
                : "A focused change with test evidence. Maintainers stay in control."}
          </p>
        </div>
      </section>
      <div className="detail-layout">
        <section aria-labelledby="timeline">
          <div className="row spread">
            <h2 id="timeline" className="section-title">
              The execution trail
            </h2>
            <span className="mono small muted">{work.time}</span>
          </div>
          <ol className="timeline">
            {timeline.map((step) => (
              <li key={step.title} className={step.state}>
                <div className="row spread">
                  <strong>{step.title}</strong>
                  <span className="mono">{money(step.cost)}</span>
                </div>
                <p>{step.detail}</p>
              </li>
            ))}
          </ol>
          <div className="info-box" style={{ marginTop: 26 }}>
            <p className="eyebrow" style={{ marginBottom: 9 }}>
              CONTRIBUTION → AGENT RUN → WORK UNIT → RESULT
            </p>
            <p>
              The budget is reserved before execution. Actual compute is debited
              once, and the unused reservation returns to the same pool.
            </p>
          </div>
          <Link
            href="/dashboard#ledger"
            className="text-link"
            style={{ marginTop: 23 }}
          >
            <ArrowLeft size={13} />
            Follow the contribution in your ledger
          </Link>
        </section>
        <aside>
          <section className="panel">
            <div className="row spread">
              <h2>Cost breakdown</h2>
              <StatusBadge status={work.status} />
            </div>
            <dl className="summary-lines" style={{ marginTop: 25 }}>
              <div>
                <dt>Reserved</dt>
                <dd>{money(work.capCents)}</dd>
              </div>
              <div>
                <dt>{finished ? "Actual debit" : "Cost so far"}</dt>
                <dd>{money(work.costCents)}</dd>
              </div>
              <div className="divider">
                <dt>{finished ? "Released" : "Still reserved"}</dt>
                <dd className={finished ? "ok" : "amber"}>
                  {money(work.capCents - work.costCents)}
                </dd>
              </div>
              <div>
                <dt>Pool</dt>
                <dd>
                  <PoolBadge pool={work.pool} />
                </dd>
              </div>
            </dl>
          </section>
          <section className="panel evidence-panel">
            <h2>{abstained ? "Abstention evidence" : "Delivery evidence"}</h2>
            <ul>
              {(abstained
                ? [
                    "Scope reviewed",
                    "Missing acceptance criteria recorded",
                    "Unused budget released",
                  ]
                : running
                  ? [
                      "Issue authorization checked",
                      "Budget reserved",
                      "Candidate patch prepared",
                    ]
                  : [
                      "Issue authorization checked",
                      "Regression tests passed",
                      "Patch and run log attached",
                      "Unused budget released",
                    ]
              ).map((item) => (
                <li key={item}>
                  <Check size={13} />
                  {item}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </main>
  );
}

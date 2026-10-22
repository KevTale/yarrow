import Link from "next/link";
import { ArrowUpRight, GitBranch, Terminal } from "lucide-react";
import { PoolBadge } from "./ui";

export function WorkPreview() {
  return (
    <div className="work-preview">
      <div className="panel-header">
        <span className="eyebrow">
          <span className="live-dot" />
          Work unit <span className="muted">/ preview</span>
        </span>
        <span className="mono small muted">wu_8f3a21</span>
      </div>
      <div className="preview-body">
        <div className="row spread">
          <span className="mono small muted">
            <GitBranch size={13} /> tidepool/tidepool-server
          </span>
          <PoolBadge pool="commons" />
        </div>
        <h3>Pool drain leaks sockets on SIGTERM</h3>
        <p className="mono small muted">GitHub issue #4821</p>
        <ol className="pipeline" aria-label="Example pipeline progress">
          {["Claimed", "Planned", "Patched", "Tests", "PR"].map((step, i) => (
            <li
              className={i < 3 ? "done" : i === 3 ? "active" : ""}
              key={step}
              aria-current={i === 3 ? "step" : undefined}
            >
              <span />
              <small>{step}</small>
            </li>
          ))}
        </ol>
        <div className="terminal">
          <div className="terminal-title">
            <Terminal size={13} />
            <span>runner / output</span>
            <span className="terminal-cursor" />
          </div>
          <div>
            <time>12:41:07</time>
            <span>planner</span>
            <span>scope: 2 files, 1 test</span>
          </div>
          <div>
            <time>12:41:52</time>
            <span>coder</span>
            <span>
              patch <b className="ok">+142</b> <b className="error">−37</b>
            </span>
          </div>
          <div>
            <time>12:43:10</time>
            <span>runner</span>
            <span>
              pool:: <b className="ok">48 passed</b>
            </span>
          </div>
          <div>
            <time>12:43:31</time>
            <span>runner</span>
            <span className="amber">integration/sigterm…</span>
          </div>
        </div>
        <dl className="preview-stats">
          <div>
            <dt className="eyebrow">Cost so far</dt>
            <dd className="mono">$2.18</dd>
          </div>
          <div>
            <dt className="eyebrow">Budget cap</dt>
            <dd className="mono">$8.00</dd>
          </div>
          <div>
            <dt className="eyebrow">Outcome</dt>
            <dd className="mono small">PR or abstain</dd>
          </div>
        </dl>
      </div>
      <Link href="/work/wu_8f3a21" className="preview-footer">
        <span>Every run leaves a trail.</span>
        <span>
          View work unit <ArrowUpRight size={14} />
        </span>
      </Link>
    </div>
  );
}

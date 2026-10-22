"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, Check, Github, Layers3 } from "lucide-react";
import { projectSchema } from "@/core/forms";
import { money } from "@/core/packs";
import type { Pool } from "@/core/forms";
import { saveDemoProject } from "@/lib/demo-storage";
import { PoolBadge } from "./ui";

export function ProjectForm() {
  const [name, setName] = useState("");
  const [repository, setRepository] = useState("");
  const [pool, setPool] = useState<Pool>("commons");
  const [jiraSite, setJiraSite] = useState("");
  const [jiraJql, setJiraJql] = useState("");
  const [label, setLabel] = useState("agent-ok");
  const [cap, setCap] = useState("8");
  const [feedback, setFeedback] = useState("");
  const [integrationFeedback, setIntegrationFeedback] = useState("");
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  const capCents = Math.round(Number(cap) * 100);

  async function connect(provider: "github" | "jira") {
    try {
      const response = await fetch(`/api/integrations/${provider}`, {
        method: "POST",
      });
      const data = (await response.json()) as { error: string };
      setIntegrationFeedback(data.error);
    } catch {
      setIntegrationFeedback(
        "Could not reach the integration. You can still save a local draft.",
      );
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");
    setError(false);
    const parsed = projectSchema.safeParse({
      name,
      repository,
      pool,
      authorizationLabel: label,
      jiraSite,
      jiraJql,
      capCents,
      draftPullRequests: true,
      requirePassingTests: true,
    });
    if (!parsed.success) {
      setError(true);
      setFeedback(
        parsed.error.issues[0]?.message ?? "Check the project fields.",
      );
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(data.error ?? "Could not validate this project.");
      saveDemoProject(parsed.data);
      setFeedback(
        "Project draft saved in this browser. Connect GitHub and fund its pool before agents can start.",
      );
    } catch (cause) {
      setError(true);
      setFeedback(
        cause instanceof Error
          ? cause.message
          : "Could not save the draft. Check that browser storage is enabled.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="form-layout" onSubmit={submit}>
      <ol className="stepper">
        <li>
          <span className="step-marker">1</span>
          <h2>A home for your work</h2>
          <div className="field-grid">
            <label className="field">
              Project name
              <input
                name="name"
                autoComplete="off"
                required
                minLength={2}
                maxLength={80}
                placeholder="e.g. Sillage Web Console"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="field">
              GitHub repository
              <input
                name="repository"
                autoComplete="off"
                required
                placeholder="owner/repository"
                pattern={"[A-Za-z0-9][A-Za-z0-9_.\\-]*/[A-Za-z0-9_.\\-]+"}
                value={repository}
                onChange={(event) => setRepository(event.target.value)}
              />
            </label>
          </div>
        </li>
        <li>
          <span className="step-marker">2</span>
          <h2>Connect the sources</h2>
          <div className="integration-grid">
            <div className="integration-card">
              <div className="row spread">
                <strong className="row">
                  <Github size={19} />
                  GitHub
                </strong>
                <span className="small muted">Not connected</span>
              </div>
              <p className="small muted">
                Issues in. Draft pull requests out. Only repositories you
                authorize.
              </p>
              <button
                type="button"
                className="button button-secondary button-small button-full"
                onClick={() => connect("github")}
              >
                Connect GitHub App <ArrowRight size={13} />
              </button>
            </div>
            <div className="integration-card">
              <div className="row spread">
                <strong className="row">
                  <Layers3 size={18} />
                  Jira
                </strong>
                <span className="small muted">Optional</span>
              </div>
              <label className="field">
                Dedicated Jira site
                <input
                  name="jiraSite"
                  placeholder="your-demo.atlassian.net"
                  value={jiraSite}
                  onChange={(event) => setJiraSite(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="button button-secondary button-small button-full"
                onClick={() => connect("jira")}
              >
                Connect Jira <ArrowRight size={13} />
              </button>
            </div>
          </div>
          {integrationFeedback && (
            <p className="feedback" role="status">
              {integrationFeedback}
            </p>
          )}
        </li>
        <li>
          <span className="step-marker">3</span>
          <fieldset>
            <legend className="section-title" style={{ marginBottom: 18 }}>
              Choose your pool
            </legend>
            <div className="type-grid">
              {(["commons", "commercial"] as const).map((value) => (
                <label className="radio-card" key={value}>
                  <input
                    type="radio"
                    name="pool"
                    value={value}
                    checked={pool === value}
                    onChange={() => setPool(value)}
                  />
                  <span className="radio-card-content">
                    <PoolBadge pool={value} />
                    <span className="pack-description">
                      {value === "commons"
                        ? "Open source under an OSI license. Open to commons funding."
                        : "Your product, your dedicated pool. Open to opted-in funders."}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </li>
        <li>
          <span className="step-marker">4</span>
          <h2>Set the boundaries</h2>
          <div className="field-grid">
            <label className="field">
              GitHub authorization label
              <input
                name="label"
                required
                maxLength={50}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </label>
            <label className="field">
              Budget cap per work unit (USD)
              <input
                name="cap"
                type="number"
                required
                min="1"
                max="50"
                step="0.01"
                value={cap}
                onChange={(event) => setCap(event.target.value)}
              />
            </label>
            <label className="field">
              Jira JQL · optional
              <input
                name="jql"
                maxLength={500}
                placeholder="project = DEMO AND labels = agent-ok"
                value={jiraJql}
                onChange={(event) => setJiraJql(event.target.value)}
              />
            </label>
            <div className="field">
              <span>Execution</span>
              <div className="info-box">
                One orchestrator → PR or abstention
              </div>
            </div>
          </div>
          <div className="info-box" style={{ marginTop: 20 }}>
            <p className="row">
              <Check size={14} className="ok" />
              Pull requests are always drafts.
            </p>
            <p className="row">
              <Check size={14} className="ok" />
              Passing tests and evidence are required.
            </p>
            <p className="row">
              <Check size={14} className="ok" />
              Unclear scope leads to a documented abstention.
            </p>
          </div>
        </li>
      </ol>
      <aside aria-label="Project preview">
        <div className="summary-card">
          <div className="summary-top">
            <p className="eyebrow">PROJECT PREVIEW</p>
            <h3 className="project-summary-name">
              {name || "Your next project"}
            </h3>
            <p className="mono small muted">
              {repository || "owner/repository"}
            </p>
            <PoolBadge pool={pool} />
          </div>
          <div className="summary-content">
            <dl className="summary-lines">
              <div>
                <dt>GitHub</dt>
                <dd>Not connected</dd>
              </div>
              <div>
                <dt>Jira</dt>
                <dd>Not connected</dd>
              </div>
              <div className="divider">
                <dt>Cap per work unit</dt>
                <dd>{Number.isFinite(capCents) ? money(capCents) : "—"}</dd>
              </div>
              <div>
                <dt>Matching issues</dt>
                <dd>Connect to inspect</dd>
              </div>
              <div>
                <dt>Max exposure</dt>
                <dd>Not yet known</dd>
              </div>
              <div>
                <dt>Delivery</dt>
                <dd>Draft PR</dd>
              </div>
            </dl>
            <button
              className="button button-primary button-full"
              disabled={pending}
            >
              {pending ? "Saving…" : "Save project draft"}
              <ArrowRight size={16} />
            </button>
            <p className="field-note">
              Saved in this browser only. No agent starts and no external
              account is connected.
            </p>
            {feedback && (
              <div
                className={`feedback ${error ? "feedback-error" : ""}`}
                role={error ? "alert" : "status"}
              >
                {feedback}
                {!error && (
                  <Link href="/dashboard">
                    View my activity <ArrowRight size={13} />
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      </aside>
    </form>
  );
}

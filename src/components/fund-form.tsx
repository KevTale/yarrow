"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, Check, LockKeyhole } from "lucide-react";
import { money, packs, type PackId } from "@/core/packs";
import type { Pool } from "@/core/forms";
import { demoProjects } from "@/lib/demo-data";
import { PoolBadge } from "./ui";

export function FundForm({ initialPack }: { initialPack: PackId }) {
  const [packId, setPackId] = useState<PackId>(initialPack);
  const [pool, setPool] = useState<Pool>("commons");
  const [projectId, setProjectId] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  const pack = packs.find((item) => item.id === packId)!;
  function updatePool(value: Pool) {
    setPool(value);
    setProjectId("");
    setFeedback("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFeedback("");
    setError(false);
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packId,
          pool,
          projectId: projectId || null,
          visibility,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        message?: string;
      };
      if (!response.ok)
        throw new Error(data.error ?? "Could not preview checkout.");
      setFeedback(data.message ?? "Preview ready.");
    } catch (cause) {
      setError(true);
      setFeedback(cause instanceof Error ? cause.message : "Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="form-layout">
      <div className="form-main">
        <fieldset className="form-section">
          <legend className="eyebrow">01 / Choose your pack</legend>
          <div className="pack-options">
            {packs.map((item) => (
              <label className="radio-card" key={item.id}>
                <input
                  type="radio"
                  name="pack"
                  value={item.id}
                  checked={packId === item.id}
                  onChange={() => {
                    setPackId(item.id);
                    setFeedback("");
                  }}
                />
                <span className="radio-card-content">
                  <span className="pack-name">{item.name}</span>
                  <span className="pack-price mono">
                    {money(item.amountCents, false)}
                  </span>
                  <span className="pack-description">{item.description}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="field-note mono">
            One-time payment. Work delivered depends on issue scope and compute
            used.
          </p>
        </fieldset>
        <fieldset className="form-section">
          <legend className="eyebrow">02 / Give it a direction</legend>
          <div className="choice-list">
            <label className="choice-row">
              <input
                type="radio"
                name="pool"
                value="commons"
                checked={pool === "commons"}
                onChange={() => updatePool("commons")}
              />
              <span>
                <strong>Back the commons</strong>
                <small>
                  Help maintain open-source projects everyone can use.
                </small>
              </span>
              <PoolBadge pool="commons" />
            </label>
            <label className="choice-row">
              <input
                type="radio"
                name="pool"
                value="commercial"
                checked={pool === "commercial"}
                onChange={() => updatePool("commercial")}
              />
              <span>
                <strong>Back commercial work</strong>
                <small>
                  Support product teams and their dedicated project pools.
                </small>
              </span>
              <PoolBadge pool="commercial" />
            </label>
          </div>
          <label className="field" style={{ marginTop: 18 }}>
            Project destination
            <select
              name="project"
              value={projectId}
              onChange={(event) => {
                setProjectId(event.target.value);
                setFeedback("");
              }}
            >
              <option value="">Any {pool} project</option>
              {demoProjects
                .filter((project) => project.pool === pool)
                .map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
            </select>
          </label>
          <p className="field-note">
            Your credit stays in the selected pool. Commons and commercial funds
            remain separate.
          </p>
        </fieldset>
        <fieldset className="form-section">
          <legend className="eyebrow">03 / Your place on the board</legend>
          <div className="choice-list">
            <label className="choice-row">
              <input
                type="radio"
                name="visibility"
                value="public"
                checked={visibility === "public"}
                onChange={() => setVisibility("public")}
              />
              <span>
                <strong>Show my name</strong>
                <small>
                  Your settled contributions count toward your public rank.
                </small>
              </span>
            </label>
            <label className="choice-row">
              <input
                type="radio"
                name="visibility"
                value="anonymous"
                checked={visibility === "anonymous"}
                onChange={() => setVisibility("anonymous")}
              />
              <span>
                <strong>Keep it anonymous</strong>
                <small>
                  The work still counts. Your name stays off the board.
                </small>
              </span>
            </label>
          </div>
        </fieldset>
      </div>
      <aside aria-label="Order summary">
        <div className="summary-card">
          <div className="summary-top">
            <p className="eyebrow">YOUR CONTRIBUTION</p>
            <p className="summary-price mono" aria-live="polite">
              {money(pack.amountCents, false)}
              <span>.00</span>
            </p>
            <p className="small muted" style={{ marginTop: 7 }}>
              {pack.name} pack · one-time
            </p>
          </div>
          <div className="summary-content">
            <dl className="summary-lines">
              <div>
                <dt>Pack amount</dt>
                <dd>{money(pack.amountCents)}</dd>
              </div>
              <div>
                <dt>Final fees & compute credit</dt>
                <dd>At checkout</dd>
              </div>
              <div className="divider">
                <dt>Pool</dt>
                <dd>
                  <PoolBadge pool={pool} />
                </dd>
              </div>
              <div>
                <dt>Destination</dt>
                <dd>
                  {demoProjects.find((p) => p.id === projectId)?.name ??
                    "Open queue"}
                </dd>
              </div>
              <div>
                <dt>Leaderboard</dt>
                <dd>{visibility === "public" ? "Public" : "Anonymous"}</dd>
              </div>
            </dl>
            <button
              className="button button-primary button-full"
              disabled={pending}
            >
              {pending
                ? "Preparing preview…"
                : `Preview ${money(pack.amountCents)} checkout`}
              <ArrowRight size={16} />
            </button>
            <p className="field-note row">
              <LockKeyhole size={12} /> Demo only · no card required
            </p>
            {feedback && (
              <div
                className={`feedback ${error ? "feedback-error" : ""}`}
                role={error ? "alert" : "status"}
              >
                {feedback}
                {!error && (
                  <Link href="/dashboard">
                    Explore your activity <ArrowRight size={13} />
                  </Link>
                )}
              </div>
            )}
            <ul className="summary-checks">
              <li>
                <Check size={13} />
                Unused credit stays in your pool
              </li>
              <li>
                <Check size={13} />
                Every run leaves an itemized record
              </li>
              <li>
                <Check size={13} />A PR or a documented abstention
              </li>
            </ul>
          </div>
        </div>
      </aside>
    </form>
  );
}

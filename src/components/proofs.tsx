import {
  ArrowUpRight,
  Check,
  ChevronsLeftRight,
  CircleDashed,
  FileText,
  KeyRound,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  changedAt,
  foldOutput,
  leadProof,
  measureChange,
  outputDiff,
  type Proof,
  type PullChecks,
} from "@/core/proofs";

type ImagesProof = Extract<Proof, { kind: "images" }>;
type OutputProof = Extract<Proof, { kind: "output" }>;
type MeasureProof = Extract<Proof, { kind: "measure" }>;

/** A file of the pull request's branch on GitHub, from the pull request's address. */
export function branchFileUrl(
  pullRequestUrl: string | null,
  branch: string | null,
  file: string,
): string | null {
  const repository = pullRequestUrl?.match(
    /^(https:\/\/github\.com\/[^/]+\/[^/]+)\/pull\/\d+$/,
  )?.[1];
  if (!repository || !branch) return null;
  const path = (text: string) =>
    text.split("/").map(encodeURIComponent).join("/");
  return `${repository}/blob/${path(branch)}/${path(file)}`;
}

/** The pull request's app: its page, and its test account when its session did not follow. */
export interface AppLink {
  href: string;
  signIn: { login: string; password: string } | null;
}

/** The one thing the pull request shows beside no film (src/core/proofs.ts). */
export function Proofs({
  proofs,
  document,
}: {
  proofs: Proof[];
  /** A document on the pull request's branch, when it can be linked. */
  document: (file: string) => string | null;
}) {
  const lead = leadProof(proofs);
  if (!lead) return null;
  if (lead.kind === "images") return <Slider proof={lead} />;
  return lead.kind === "measure" || lead.kind === "output" ? (
    <ProofBlock proof={lead} />
  ) : (
    <ProofLink proof={lead} document={document} />
  );
}

/** A proof that reads in place: a number, an example. */
export function ProofBlock({ proof }: { proof: MeasureProof | OutputProof }) {
  return proof.kind === "measure" ? (
    <Measure proof={proof} />
  ) : (
    <Example proof={proof} />
  );
}

/** A proof that opens elsewhere, a button: a document, GitHub's check. */
export function ProofLink({
  proof,
  document,
  checks = null,
}: {
  proof: Proof;
  document: (file: string) => string | null;
  /** GitHub's checks, read live: none, nothing to say. */
  checks?: PullChecks | null;
}) {
  if (proof.kind === "document") {
    const href = document(proof.file);
    return href && <DocumentLink file={proof.file} href={href} />;
  }
  return proof.kind === "check" && checks && <CheckLink checks={checks} />;
}

const load = (src: string) =>
  new Promise<HTMLImageElement>((done, failed) => {
    const image = new Image();
    image.onload = () => done(image);
    image.onerror = failed;
    image.src = src;
  });

/** The images' width where they are compared: a button still shows at it. */
const COMPARED = 320;

/** An image's pixels at the width compared, for that height. */
function pixels(image: HTMLImageElement, height: number): Uint8ClampedArray {
  const canvas = document.createElement("canvas");
  canvas.width = COMPARED;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(
    image,
    0,
    0,
    COMPARED,
    (COMPARED * image.naturalHeight) / image.naturalWidth,
  );
  return context.getImageData(0, 0, COMPARED, height).data;
}

/**
 * A screen as it was and as it is, one image with a line to slide across:
 * it opens on what changed, at the film's size and in its place. The whole
 * page shows, a phone's in the middle of the stage; cinema mode enlarges.
 */
export function Slider({
  proof,
  tools,
}: {
  proof: ImagesProof;
  /** Its button, over the image as over the film. */
  tools?: ReactNode;
}) {
  const before = proof.before && `/evidence/${proof.before}`;
  const after = `/evidence/${proof.after}`;
  const [ratio, setRatio] = useState(
    proof.device === "phone" ? 390 / 844 : 16 / 10,
  );
  const [position, setPosition] = useState(50);
  useEffect(() => {
    let gone = false;
    void Promise.all([load(after), before ? load(before) : null])
      .then(([now, was]) => {
        if (gone) return;
        setRatio(now.naturalWidth / now.naturalHeight);
        if (!was) return;
        const height = Math.round(
          (COMPARED * now.naturalHeight) / now.naturalWidth,
        );
        const at = changedAt(
          pixels(was, height),
          pixels(now, height),
          COMPARED,
        );
        if (at !== null) setPosition(at);
      })
      // Left at the middle: the line still slides.
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [before, after]);
  return (
    <div className="pf-hero">
      <div
        className={ratio < 1 ? "pf-frame pf-tall" : "pf-frame"}
        style={{ "--ratio": ratio } as CSSProperties}
      >
        <div className="pf-layer">
          <img src={after} alt={proof.label} />
        </div>
        {before && (
          <>
            <div
              className="pf-layer"
              style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
            >
              <img src={before} alt={`${proof.label}, before`} />
            </div>
            <input
              className="pf-range"
              type="range"
              min={0}
              max={100}
              step={0.25}
              value={position}
              aria-label="Slide between before and after"
              onChange={(event) => setPosition(Number(event.target.value))}
            />
            <span className="pf-cut" style={{ left: `${position}%` }}>
              <span className="pf-grip">
                <ChevronsLeftRight size={16} aria-hidden="true" />
              </span>
            </span>
          </>
        )}
      </div>
      {before && (
        <>
          <span className="pf-tag">Before</span>
          <span className="pf-tag pf-after">After</span>
        </>
      )}
      {tools && <div className="pv-bar pf-tools">{tools}</div>}
    </div>
  );
}

/** What opens elsewhere: a button whose arrow says so. */
function Away({
  href,
  title,
  children,
}: {
  href: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <a
      className="pp-act"
      href={href}
      title={title}
      target="_blank"
      rel="noopener"
    >
      {children}
      <ArrowUpRight size={14} aria-hidden="true" />
    </a>
  );
}

/** The pull request's app in a new tab; its account beside it when it is needed. */
export function OpenApp({ app }: { app: AppLink }) {
  return (
    <span className="pf-app">
      {app.signIn && <Account signIn={app.signIn} />}
      <Away href={app.href}>Open the app</Away>
    </span>
  );
}

/** The test account, once the visit's session could not be copied. */
function Account({ signIn }: { signIn: NonNullable<AppLink["signIn"]> }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="pf-account"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="pv-icon"
        aria-expanded={open}
        aria-label="Test account"
        data-tip={open ? undefined : "Test account"}
        onClick={() => setOpen(!open)}
      >
        <KeyRound size={18} aria-hidden="true" />
      </button>
      {open && (
        <span className="pf-menu">
          <Copy icon={UserRound} text={signIn.login} label="Copy the login" />
          <Copy
            icon={KeyRound}
            text={signIn.password}
            label="Copy the password"
          />
        </span>
      )}
    </span>
  );
}

/** A value copied on a click; a tick says it was. */
function Copy({
  icon: Icon,
  text,
  label,
}: {
  icon: LucideIcon;
  text: string;
  label: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      aria-label={`${label}: ${text}`}
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => setCopied(true))
      }
    >
      {copied ? (
        <Check size={14} aria-hidden="true" />
      ) : (
        <Icon size={14} aria-hidden="true" />
      )}
      <span>{text}</span>
    </button>
  );
}

/**
 * What a request or a command gives, read without a terminal: what it gives
 * now, the lines that changed marked, the rest folded until asked for. The
 * command stays in the description, for developers.
 */
function Example({ proof }: { proof: OutputProof }) {
  const [whole, setWhole] = useState(false);
  const lines = useMemo(
    () =>
      proof.before === null
        ? proof.after
            .split("\n")
            .map((text) => ({ kind: "same" as const, text }))
        : outputDiff(proof.before, proof.after),
    [proof.before, proof.after],
  );
  // A change that only took lines away shows them going.
  const now = lines.some((line) => line.kind === "added")
    ? lines.filter((line) => line.kind !== "removed")
    : lines;
  const shown = whole ? now : foldOutput(now);
  return (
    <figure className="pf-out">
      <figcaption>{proof.label}</figcaption>
      <div className="pf-print">
        {shown.map((line, index) =>
          "folded" in line ? (
            <button
              key={index}
              type="button"
              className="pf-fold"
              onClick={() => setWhole(true)}
            >
              {line.folded} more lines
            </button>
          ) : (
            <div key={index} className={`pf-line pf-${line.kind}`}>
              {line.text || " "}
            </div>
          ),
        )}
      </div>
    </figure>
  );
}

const amount = (value: number) => value.toLocaleString("en-US");

/** A measure as it was and is, as two bars, and how far it moved. */
function Measure({ proof }: { proof: MeasureProof }) {
  const change = measureChange(proof);
  const improved =
    proof.better === "lower"
      ? proof.after < proof.before
      : proof.after > proof.before;
  const widest = Math.max(Math.abs(proof.before), Math.abs(proof.after)) || 1;
  const bar = (value: number, className: string) => (
    <i
      className={className}
      style={{ flexBasis: `${(Math.abs(value) / widest) * 100}%` }}
    />
  );
  return (
    <figure className="pf-num">
      <figcaption>{proof.label}</figcaption>
      <div className="pf-row">
        Before
        <div className="pf-track">
          {bar(proof.before, "pf-was")}
          <span>
            {amount(proof.before)} {proof.unit}
          </span>
        </div>
      </div>
      <div className="pf-row">
        Now
        <div className="pf-track">
          {bar(proof.after, improved ? "pf-now" : "pf-now pf-down")}
          <span>
            {amount(proof.after)} {proof.unit}
          </span>
          {change && change !== "unchanged" && (
            <b className={improved ? undefined : "pf-down"}>{change}</b>
          )}
        </div>
      </div>
    </figure>
  );
}

function DocumentLink({ file, href }: { file: string; href: string }) {
  return (
    <Away href={href} title={file}>
      <FileText size={15} aria-hidden="true" />
      {file.slice(file.lastIndexOf("/") + 1)}
    </Away>
  );
}

const CHECK_MARK = { passed: Check, failed: X, running: CircleDashed } as const;

/** GitHub's own word on the pull request: what its checks say now. */
function CheckLink({ checks }: { checks: PullChecks }) {
  const Mark = CHECK_MARK[checks.state];
  const one = checks.count === 1;
  const word =
    checks.state !== "running"
      ? checks.state
      : one
        ? "is running"
        : "are running";
  return (
    <Away href={checks.url}>
      <em className={`pf-mark pf-${checks.state}`}>
        <Mark size={10} strokeWidth={3} aria-hidden="true" />
      </em>
      {one ? checks.name : `${checks.count} checks`} {word}
      {checks.seconds !== null && <small>{checks.seconds}s</small>}
    </Away>
  );
}

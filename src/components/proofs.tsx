import { ArrowRight, ArrowUpRight, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { measureChange, type Proof } from "@/core/proofs";

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

/**
 * What proves the pull request, chosen for it by the implementer
 * (src/core/proofs.ts): screens as they were and are, what a command
 * printed, a measure, the documents. The app's page is the preview's link.
 */
export function Proofs({
  proofs,
  document,
}: {
  proofs: Proof[];
  /** A document on the pull request's branch, when it can be linked. */
  document: (file: string) => string | null;
}) {
  const shown = proofs.filter((proof) => proof.kind !== "app");
  if (shown.length === 0) return null;
  const images = shown.filter(
    (proof): proof is ImagesProof => proof.kind === "images",
  );
  const documents = shown.flatMap((proof) =>
    proof.kind === "document" ? [proof.file] : [],
  );
  return (
    <section className="pp-section pf">
      <h3>Proof</h3>
      {images.length > 0 && <Pairs proofs={images} />}
      {shown.map((proof, index) =>
        proof.kind === "output" ? (
          <Output key={index} proof={proof} />
        ) : proof.kind === "measure" ? (
          <Measure key={index} proof={proof} />
        ) : null,
      )}
      {documents.length > 0 && (
        <div className="pf-docs">
          {documents.map((file) => {
            const href = document(file);
            const name = (
              <>
                <FileText size={15} aria-hidden="true" />
                <span>{file}</span>
              </>
            );
            return href ? (
              <a
                key={file}
                className="pp-preview-open"
                href={href}
                target="_blank"
                rel="noopener"
              >
                {name}
                <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            ) : (
              <span key={file} className="pp-preview-open">
                {name}
              </span>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * Each screen as it was and as it is, side by side; full size on a click,
 * the arrows going through every image.
 */
function Pairs({ proofs }: { proofs: ImagesProof[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  const images = proofs.flatMap((proof) => [
    ...(proof.before
      ? [{ key: proof.before, label: `${proof.label}, before` }]
      : []),
    { key: proof.after, label: proof.label },
  ]);
  useEffect(() => {
    if (open !== null && !dialog.current?.open) dialog.current?.showModal();
  }, [open]);
  const shown = open === null ? null : images[open];
  const thumb = (
    key: string,
    side: "Before" | "After" | null,
    label: string,
  ) => (
    <button
      type="button"
      aria-label={`${side ? `${label}, ${side.toLowerCase()}` : label}, full size`}
      onClick={() => setOpen(images.findIndex((image) => image.key === key))}
    >
      <img src={`/evidence/${key}`} alt="" loading="lazy" />
      {side && <span className="pf-side">{side}</span>}
    </button>
  );
  return (
    <>
      <ul className="pf-pairs">
        {proofs.map((proof) => (
          <li
            key={proof.after}
            className={proof.device === "phone" ? "pf-phone" : undefined}
          >
            <div className={proof.before ? "pf-pair" : "pf-pair pf-one"}>
              {proof.before && thumb(proof.before, "Before", proof.label)}
              {thumb(proof.after, proof.before ? "After" : null, proof.label)}
            </div>
            <span>{proof.label}</span>
          </li>
        ))}
      </ul>
      <dialog
        ref={dialog}
        className="pp-shot"
        aria-label={shown?.label ?? "Screen"}
        onClose={() => setOpen(null)}
        onClick={() => dialog.current?.close()}
        onKeyDown={(event) => {
          if (open === null || images.length < 2) return;
          const step =
            event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          if (step) setOpen((open + step + images.length) % images.length);
        }}
      >
        {shown && (
          <figure>
            <img
              key={shown.key}
              src={`/evidence/${shown.key}`}
              alt={shown.label}
            />
            <figcaption>
              {shown.label}
              {images.length > 1 && (
                <span>
                  {open! + 1} / {images.length}
                </span>
              )}
            </figcaption>
          </figure>
        )}
      </dialog>
    </>
  );
}

/** A command or request and what it printed, now; before, on a click. */
function Output({ proof }: { proof: OutputProof }) {
  const [side, setSide] = useState<"before" | "after">("after");
  const text = side === "before" ? proof.before : proof.after;
  return (
    <figure className="pf-out">
      <figcaption>
        <span>{proof.label}</span>
        {proof.before !== null && (
          <span className="pf-sides" role="group" aria-label={proof.label}>
            {(["before", "after"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={side === value}
                onClick={() => setSide(value)}
              >
                {value === "before" ? "Before" : "After"}
              </button>
            ))}
          </span>
        )}
      </figcaption>
      <pre>
        <code>
          <span className="pf-command">{proof.command}</span>
          {"\n"}
          {text || " "}
        </code>
      </pre>
    </figure>
  );
}

/** A measure as it was and is, and how far it moved. */
function Measure({ proof }: { proof: MeasureProof }) {
  const change = measureChange(proof);
  const improved =
    proof.better === "lower"
      ? proof.after < proof.before
      : proof.after > proof.before;
  return (
    <div className="pf-measure">
      <span>{proof.label}</span>
      <span className="pf-values">
        <span className="pf-was">
          {proof.before} {proof.unit}
        </span>
        <ArrowRight size={13} aria-label="to" />
        <b>
          {proof.after} {proof.unit}
        </b>
        {change && change !== "unchanged" && (
          <span className={improved ? "pf-better" : "pf-worse"}>{change}</span>
        )}
      </span>
    </div>
  );
}

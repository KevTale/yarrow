import { ChevronLeft, ChevronRight, FileDiff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { groupFiles } from "@/core/changed-files";
import type { PullFile } from "@/server/github/pulls.server";

/** Lines added and taken away. */
function Count({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="pp-count">
      <span className="add">+{added}</span>
      {removed > 0 && (
        <>
          {" "}
          <span className="del">−{removed}</span>
        </>
      )}
    </span>
  );
}

/**
 * The files a pull request changed, a button at the panel's foot: how many
 * and their lines. They open over the page, at one size and in one place
 * whatever the file, the list on the left in the order a builder reads them
 * (the code, its tests, its documentation, what tools generated, the assets),
 * the header's arrows and the keyboard's going from one file to the next, so
 * the panel and its conversation never move.
 */
export function FilesChanged({ files }: { files: PullFile[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const rail = useRef<HTMLElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    if (open === null) return;
    if (!dialog.current?.open) dialog.current?.showModal();
    rail.current?.querySelector(".on")?.scrollIntoView({ block: "nearest" });
  }, [open]);

  // One list, the code first: the groups' order without their names.
  const ordered = groupFiles(files).flatMap((group) => group.files);
  const total = (
    <Count
      added={files.reduce((sum, file) => sum + file.additions, 0)}
      removed={files.reduce((sum, file) => sum + file.deletions, 0)}
    />
  );
  const title = `${files.length} ${files.length === 1 ? "file" : "files"} changed`;
  const shown = open === null ? null : ordered[open];
  // The previous or next file, round the list.
  const go = (step: number) => {
    if (ordered.length < 2) return;
    setOpen((at) =>
      at === null ? at : (at + step + ordered.length) % ordered.length,
    );
  };
  return (
    <>
      <button type="button" className="pp-act" onClick={() => setOpen(0)}>
        <FileDiff size={15} aria-hidden="true" />
        {title}
        {total}
      </button>
      <dialog
        ref={dialog}
        className="pp-diffs"
        aria-label="The changes"
        onClose={() => setOpen(null)}
        // A click beside the changes closes them.
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
        onKeyDown={(event) => {
          const step =
            event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          if (step) go(step);
        }}
      >
        {shown && (
          <>
            <nav ref={rail} className="pp-rail" aria-label="Files">
              <p className="pp-rail-title">
                {title}
                {total}
              </p>
              {ordered.map((file, i) => {
                const slash = file.path.lastIndexOf("/");
                return (
                  <button
                    key={file.path}
                    type="button"
                    className={i === open ? "pp-rail-file on" : "pp-rail-file"}
                    title={file.path}
                    aria-current={i === open}
                    onClick={() => setOpen(i)}
                  >
                    <span className="pp-rail-name">
                      <b>{file.path.slice(slash + 1)}</b>
                      {slash > 0 && <small>{file.path.slice(0, slash)}</small>}
                    </span>
                    <Count added={file.additions} removed={file.deletions} />
                  </button>
                );
              })}
            </nav>
            <div className="pp-diffs-box">
              <div className="pp-diffs-head">
                <span className="pp-path">
                  {shown.path.slice(0, shown.path.lastIndexOf("/") + 1)}
                  <b>{shown.path.slice(shown.path.lastIndexOf("/") + 1)}</b>
                </span>
                <Count added={shown.additions} removed={shown.deletions} />
                {ordered.length > 1 && (
                  <span className="pp-diffs-at">
                    <button
                      type="button"
                      className="tix-icon-btn"
                      aria-label="Previous file"
                      onClick={() => go(-1)}
                    >
                      <ChevronLeft size={15} />
                    </button>
                    {open! + 1} / {ordered.length}
                    <button
                      type="button"
                      className="tix-icon-btn"
                      aria-label="Next file"
                      onClick={() => go(1)}
                    >
                      <ChevronRight size={15} />
                    </button>
                  </span>
                )}
                <button
                  type="button"
                  className="tix-icon-btn"
                  aria-label="Close"
                  onClick={() => dialog.current?.close()}
                >
                  <X size={15} />
                </button>
              </div>
              {/* Keyed: each file opens at its top. */}
              <div key={shown.path} className="pp-diffs-body">
                {shown.lines ? (
                  <div className="pp-diff" role="table" aria-label={shown.path}>
                    {shown.lines.map((line, i) =>
                      line.kind === "hunk" ? (
                        <div key={i} className="pp-hunk" role="row">
                          {line.text}
                        </div>
                      ) : (
                        <div
                          key={i}
                          className={`pp-line ${line.kind}`}
                          role="row"
                        >
                          <span className="n">
                            {line.kind === "add" ? "" : line.old}
                          </span>
                          <span className="n">
                            {line.kind === "del" ? "" : line.new}
                          </span>
                          <span className="s">
                            {line.kind === "add"
                              ? "+"
                              : line.kind === "del"
                                ? "−"
                                : ""}
                          </span>
                          <span className="c">{line.text}</span>
                        </div>
                      ),
                    )}
                  </div>
                ) : (
                  <p className="pp-none muted">No preview for this file</p>
                )}
              </div>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}

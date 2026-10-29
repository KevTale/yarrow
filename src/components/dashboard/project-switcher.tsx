import { Check, ChevronDown, GitPullRequest, Plus } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { motionTokens } from "@/components/arc/lib/motion-tokens";
import { Logo } from "@/components/boards";

type Project = { id: string; name: string; logoUrl: string | null };

/**
 * The page's title is the project's name, and opens the way to the others:
 * the pull requests waiting across projects, each project, and adding one.
 */
export function ProjectSwitcher({
  projects,
  current,
  reviewing,
  toReview,
  onProject,
  onReview,
}: {
  projects: Project[];
  current: Project | null;
  /** Showing the pull requests to review across projects. */
  reviewing: boolean;
  toReview: number;
  onProject: (id: string) => void;
  onReview: () => void;
}) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const items = [
        ...(menu.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ??
          []),
      ];
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === "ArrowDown"
          ? (at + 1) % items.length
          : (at - 1 + items.length) % items.length;
      items[next]?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keys);
    // The chosen item, or the first, takes the focus.
    requestAnimationFrame(() =>
      (
        menu.current?.querySelector<HTMLElement>("[aria-checked=true]") ??
        menu.current?.querySelector<HTMLElement>("[role^=menuitem]")
      )?.focus(),
    );
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keys);
    };
  }, [open]);

  const pick = (go: () => void) => {
    setOpen(false);
    go();
  };
  return (
    <div className="ps" ref={root}>
      <button
        ref={button}
        type="button"
        className="ps-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}
      >
        <h2>{reviewing ? "To review" : current?.name}</h2>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            ref={menu}
            className="ps-menu"
            role="menu"
            aria-label="Projects"
            initial={
              reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }
            }
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={
              reduced
                ? { duration: motionTokens.duration.instant }
                : motionTokens.spring.smooth
            }
          >
            {projects.length > 1 && (
              <>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={reviewing}
                  className="ps-item"
                  onClick={() => pick(onReview)}
                >
                  <GitPullRequest size={15} aria-hidden="true" />
                  To review
                  {toReview > 0 && <span className="ps-count">{toReview}</span>}
                </button>
                <span className="ps-sep" role="separator" />
              </>
            )}
            {projects.map((project) => {
              const chosen = !reviewing && project.id === current?.id;
              return (
                <button
                  key={project.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={chosen}
                  className="ps-item"
                  onClick={() => pick(() => onProject(project.id))}
                >
                  <Logo
                    name={project.name}
                    url={project.logoUrl}
                    size="small"
                  />
                  <span className="ps-name">{project.name}</span>
                  {chosen && (
                    <Check size={15} className="ps-check" aria-hidden="true" />
                  )}
                </button>
              );
            })}
            <span className="ps-sep" role="separator" />
            <a className="ps-item" role="menuitem" href="/connect/github">
              <Plus size={15} aria-hidden="true" />
              Add a project
            </a>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

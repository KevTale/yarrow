import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";

/**
 * Realtime: the database sends a bare "changed" signal on a Supabase
 * Realtime channel (see drizzle/0007_realtime.sql) and the page refetches
 * through its own server functions. No data travels on a channel.
 */
export type LiveConfig = { url: string; key: string } | null;

const LiveContext = createContext<LiveConfig>(null);

export function LiveProvider({
  config,
  children,
}: {
  config: LiveConfig;
  children: ReactNode;
}) {
  return <LiveContext.Provider value={config}>{children}</LiveContext.Provider>;
}

let client: SupabaseClient | null = null;
function browserClient(config: NonNullable<LiveConfig>) {
  // Reads the session the server stored in cookies, for private channels.
  client ??= createBrowserClient(config.url, config.key);
  return client;
}

/**
 * A signal: "changed" when Yarrow's rows moved, "issues" when GitHub or
 * Jira says an open ticket changed (see drizzle/0019_issues_signal.sql).
 */
export type LiveSignal = { event: "changed" | "issues"; topic: string };

/**
 * Calls `onChange` shortly after any signal on these channels, with the
 * signals gathered meanwhile. `spread` adds a random delay so a crowd of
 * viewers does not refetch at once.
 */
export function useLive(
  topics: (string | null)[],
  onChange: (signals: LiveSignal[]) => void,
  spread = 0,
) {
  const config = useContext(LiveContext);
  const callback = useRef(onChange);
  useEffect(() => {
    callback.current = onChange;
  });
  const key = topics.filter(Boolean).join(",");

  useEffect(() => {
    if (!config || !key) return;
    const supabase = browserClient(config);
    const names = key.split(",");
    let timer: ReturnType<typeof setTimeout> | undefined;
    let signals: LiveSignal[] = [];
    const fire = (signal: LiveSignal) => {
      signals.push(signal);
      clearTimeout(timer);
      timer = setTimeout(
        () => {
          const gathered = signals;
          signals = [];
          callback.current(gathered);
        },
        300 + Math.random() * spread,
      );
    };
    let cancelled = false;
    let channels: ReturnType<SupabaseClient["channel"]>[] = [];
    (async () => {
      if (names.some((name) => name !== "boards")) {
        const { data } = await supabase.auth.getSession();
        if (data.session)
          await supabase.realtime.setAuth(data.session.access_token);
      }
      if (cancelled) return;
      channels = names.map((name) =>
        supabase
          .channel(name, { config: { private: name !== "boards" } })
          .on("broadcast", { event: "changed" }, () =>
            fire({ event: "changed", topic: name }),
          )
          .on("broadcast", { event: "issues" }, () =>
            fire({ event: "issues", topic: name }),
          )
          .subscribe(),
      );
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      for (const channel of channels) void supabase.removeChannel(channel);
    };
  }, [config, key, spread]);
}

const reduced = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A row's place in the page from the layout alone: a slide under way is left out. */
function layoutTop(element: HTMLElement): number {
  let top = 0;
  for (
    let node: HTMLElement | null = element;
    node;
    node = node.offsetParent as HTMLElement | null
  )
    top += node.offsetTop;
  return top;
}

/** A row's place in the list and the group it stands in, if the list has any. */
function placeOf(row: HTMLElement, base: number) {
  return {
    top: layoutTop(row) - base,
    group: row.closest<HTMLElement>("[data-flip-group]")?.dataset.flipGroup,
  };
}

/** Where each row stands in the list, by its key. */
function positions(root: HTMLElement) {
  const base = layoutTop(root);
  const places = new Map<string, ReturnType<typeof placeOf>>();
  for (const row of root.querySelectorAll<HTMLElement>("[data-flip]"))
    places.set(row.dataset.flip!, placeOf(row, base));
  return places;
}

const MOVE_MS = 500;

/**
 * A row goes to its place with what opens under it (`data-flip-box`, around
 * both), let out of its group for as long as that takes: a group clips what
 * it holds, to fold.
 */
function move(row: HTMLElement, frames: Keyframe[], easing: string) {
  const group = row.closest("[data-flip-group]");
  group?.classList.add("moving");
  (row.closest("[data-flip-box]") ?? row).animate(frames, {
    duration: MOVE_MS,
    easing,
  }).onfinish = () => group?.classList.remove("moving");
}

/** Lifted off the list: a row changing group passes over the others. */
const LIFTED = {
  zIndex: 3,
  backgroundColor: "var(--elevated)",
  boxShadow: "var(--shadow-floating)",
};

/**
 * Animates rows when the data moves: a row that changes place slides to it,
 * one that changes group (`data-flip-group`, around it) crosses the list to
 * it, a new row fades in, a row whose value changed flashes. Rows carry
 * `data-flip` (a stable key) and optionally `data-flip-value`. Only a new
 * `data` (not a filter or a search) animates; a new `scope` (another
 * project) starts over without animating.
 */
export function useFlip<T extends HTMLElement>(data: unknown, scope = "") {
  const ref = useRef<T>(null);
  const values = useRef(new Map<string, string>());
  const seen = useRef<unknown>(data);
  const seenScope = useRef(scope);
  // Where the rows stand right before new data lands, read while the page
  // still shows them. Read at the last render instead, a ticket opened
  // since (its panel loading), a font or a logo arriving had moved rows
  // the list never saw move, and the next refresh slid them all.
  const before = useRef<ReturnType<typeof positions> | null>(null);
  /* eslint-disable react-hooks/refs -- FLIP's first step: the layout before this commit */
  if (ref.current && seen.current !== data && seenScope.current === scope)
    before.current = positions(ref.current);
  /* eslint-enable react-hooks/refs */
  useLayoutEffect(() => {
    const root = ref.current;
    const from = before.current;
    before.current = null;
    if (!root) return;
    const sameScope = seenScope.current === scope;
    if (!sameScope) values.current.clear();
    const moved = seen.current !== data && sameScope ? from : null;
    seen.current = data;
    seenScope.current = scope;
    const motion = !reduced();
    const base = layoutTop(root);
    for (const row of root.querySelectorAll<HTMLElement>("[data-flip]")) {
      const key = row.dataset.flip!;
      const { top, group } = placeOf(row, base);
      const value = row.dataset.flipValue;
      const previous = values.current.get(key);
      if (value !== undefined) values.current.set(key, value);
      if (!moved || !motion) continue;
      const was = moved.get(key);
      if (was === undefined)
        row.animate(
          [
            { opacity: 0, transform: "translateY(-6px)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 450, easing: "ease-out" },
        );
      else if (was.group !== group)
        move(
          row,
          [
            { ...LIFTED, transform: `translateY(${was.top - top}px)` },
            { ...LIFTED, offset: 0.85 },
            { zIndex: 3, transform: "none" },
          ],
          "cubic-bezier(.4,0,.2,1)",
        );
      else if (was.top !== top)
        move(
          row,
          [
            { transform: `translateY(${was.top - top}px)` },
            { transform: "none" },
          ],
          "cubic-bezier(.2,.8,.2,1)",
        );
      if (previous !== undefined && value !== undefined && previous !== value)
        row.animate(
          [{ backgroundColor: "#f2b54429" }, { backgroundColor: "#f2b54400" }],
          { duration: 1800, easing: "ease-out" },
        );
    }
  });
  return ref;
}

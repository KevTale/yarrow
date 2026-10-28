import { useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useSyncExternalStore } from "react";
import { getReviewCountFn } from "@/functions/viewer.functions";

/**
 * How many pull requests wait for the builder, shared by the header and
 * the dashboard: the dashboard knows first, the header reads it again on
 * each navigation and every minute.
 */
let waiting = 0;
let seeded = false;
const listeners = new Set<() => void>();

export function setReviewCount(next: number): void {
  seeded = true;
  if (next === waiting) return;
  waiting = next;
  for (const listener of listeners) listener();
}

/** The count the page was served with, before anything reads it again. */
function seed(initial: number): void {
  if (seeded) return;
  seeded = true;
  waiting = initial;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useReviewCount(signedIn: boolean, initial: number): number {
  seed(initial);
  const read = useServerFn(getReviewCountFn);
  const path = useRouterState({ select: (state) => state.location.pathname });
  const shown = useSyncExternalStore(
    subscribe,
    () => waiting,
    () => initial,
  );
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    const load = () =>
      read()
        .then((count) => live && setReviewCount(count))
        .catch(() => {});
    const timer = setInterval(load, 60_000);
    if (path !== "/dashboard") void load();
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [signedIn, path, read]);
  return signedIn ? shown : 0;
}

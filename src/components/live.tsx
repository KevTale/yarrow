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
 * Calls `onChange` shortly after any signal on these channels. `spread`
 * adds a random delay so a crowd of viewers does not refetch at once.
 */
export function useLive(
  topics: (string | null)[],
  onChange: () => void,
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
    const fire = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => callback.current(),
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
          .on("broadcast", { event: "changed" }, fire)
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

/**
 * Animates rows when the data moves: a row that changes place slides to it,
 * a new row fades in, a row whose value changed flashes. Rows carry
 * `data-flip` (a stable key) and optionally `data-flip-value`. Only a new
 * `data` (not a filter or a search) animates; a new `scope` (another
 * project) starts over without animating.
 */
export function useFlip<T extends HTMLElement>(data: unknown, scope = "") {
  const ref = useRef<T>(null);
  const tops = useRef<Map<string, number> | null>(null);
  const values = useRef(new Map<string, string>());
  const seen = useRef<unknown>(data);
  const seenScope = useRef(scope);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const sameScope = seenScope.current === scope;
    if (!sameScope) values.current.clear();
    const before = seen.current === data || !sameScope ? null : tops.current;
    seen.current = data;
    seenScope.current = scope;
    const now = new Map<string, number>();
    const motion = !reduced();
    for (const row of root.querySelectorAll<HTMLElement>("[data-flip]")) {
      const key = row.dataset.flip!;
      const top = row.offsetTop;
      now.set(key, top);
      const value = row.dataset.flipValue;
      const previous = values.current.get(key);
      if (value !== undefined) values.current.set(key, value);
      if (!before || !motion) continue;
      const from = before.get(key);
      if (from === undefined)
        row.animate(
          [
            { opacity: 0, transform: "translateY(-6px)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 450, easing: "ease-out" },
        );
      else if (from !== top)
        row.animate(
          [{ transform: `translateY(${from - top}px)` }, { transform: "none" }],
          { duration: 500, easing: "cubic-bezier(.2,.8,.2,1)" },
        );
      if (previous !== undefined && value !== undefined && previous !== value)
        row.animate(
          [{ backgroundColor: "#f2b54429" }, { backgroundColor: "#f2b54400" }],
          { duration: 1800, easing: "ease-out" },
        );
    }
    tops.current = now;
  });
  return ref;
}

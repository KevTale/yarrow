import { useCallback, useEffect, useRef, type RefObject } from "react";

/** The room that has the word. */
let sounding: { hush: () => void } | null = null;

/**
 * One voice across the tickets open on a page: a film starting in `room`, or
 * the function this returns, silences whichever room had the word.
 */
export function useOneVoice(
  room: RefObject<HTMLElement | null>,
  hush: () => void,
) {
  const me = useRef({ hush });
  useEffect(() => {
    me.current.hush = hush;
  });
  const speak = useCallback(() => {
    if (sounding !== me.current) sounding?.hush();
    sounding = me.current;
  }, []);
  useEffect(() => {
    const self = me.current;
    const onPlay = (event: Event) => {
      if (room.current?.contains(event.target as Node)) speak();
    };
    // Media events do not bubble: caught on their way down.
    document.addEventListener("play", onPlay, true);
    return () => {
      document.removeEventListener("play", onPlay, true);
      if (sounding === self) sounding = null;
    };
  }, [room, speak]);
  return speak;
}

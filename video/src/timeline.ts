import take from "./voice-take.json";

export { take };

/**
 * The film's clock, in frames at 30 fps. Scenes cut hard on these marks,
 * and the music's sections (scripts/music.mjs) change on the same marks,
 * so every cut lands on a musical change.
 */
export const FPS = 30;
const s = (seconds: number) => Math.round(seconds * FPS);

export const SCENE = {
  intro: { from: 0, duration: s(6) },
  work: { from: s(6), duration: s(7.5) },
  dashboard: { from: s(13.5), duration: s(7.2) },
  github: { from: s(20.7), duration: s(5.3) },
  sponsors: { from: s(26), duration: s(6) },
  end: { from: s(32), duration: s(4.5) },
};
export const TOTAL = s(36.5);

/**
 * Where the film starts in public/music.mp3: its groove, measured at
 * 7.89 s, lands on the first cut (6 s).
 */
export const MUSIC_OFFSET = s(1.89);

/**
 * Each voice line: its span in the one take (public/voice/take.mp3, spans
 * from scripts/voice.mjs) and the frame it starts on in the film.
 */
export const VOICE_AT: Record<keyof typeof take, number> = {
  intro: s(0.6),
  build: s(6.3),
  review: s(9.9),
  dashboard: s(14),
  card: s(21.2),
  sponsors: s(26.3),
  end: s(32.4),
};

/** In-scene beats the music and sound effects answer (frames, absolute). */
export const BEAT = {
  pasteClick: s(2.87),
  goClick: s(5.33),
  approved: SCENE.work.from + 186,
  chevronClick: SCENE.dashboard.from + 28,
  mergeClick: SCENE.dashboard.from + 134,
  merged: SCENE.dashboard.from + 148,
  githubClick: SCENE.dashboard.from + 192,
  climb: SCENE.sponsors.from + 60,
};

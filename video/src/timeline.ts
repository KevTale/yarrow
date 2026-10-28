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
  sponsors: { from: s(26), duration: s(5) },
  end: { from: s(31), duration: s(4) },
};
export const TOTAL = s(35);

/**
 * Where the film starts in public/music.mp3: its drop, measured at 7.85 s,
 * lands on the first cut (6 s), and its last hit on the end card's cut.
 */
export const MUSIC_OFFSET = s(1.87);

/**
 * Each voice line: its span in the one take (public/voice/take.mp3, spans
 * from scripts/voice.mjs) and the frame it starts on in the film.
 */
export const VOICE_AT: Record<keyof typeof take, number> = {
  intro: s(0.6),
  write: s(6.3),
  review: s(9.9),
  dashboard: s(14),
  card: s(21.2),
  sponsors: s(26.3),
  end: s(31.4),
};

/** In-scene beats the music and sound effects answer (frames, absolute). */
export const BEAT = {
  pasteClick: s(2.87),
  goClick: s(5.33),
  approved: SCENE.work.from + 186,
  chevronClick: SCENE.dashboard.from + 28,
  githubClick: SCENE.dashboard.from + 196,
  climb: SCENE.sponsors.from + 90,
};

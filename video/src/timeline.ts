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
  intro: { from: 0, duration: s(7) },
  work: { from: s(7), duration: s(7.5) },
  dashboard: { from: s(14.5), duration: s(7.2) },
  github: { from: s(21.7), duration: s(5.3) },
  sponsors: { from: s(27), duration: s(6.5) },
  end: { from: s(33.5), duration: s(4.5) },
};
export const TOTAL = s(38);

/**
 * Where the film starts in public/music.mp3. The track is arranged for
 * the film (scripts/arrange.mjs): its groove already lands on the first
 * cut (7 s), so it plays from its start.
 */
export const MUSIC_OFFSET = 0;

/**
 * Each voice line: its span in the one take (public/voice/take.mp3, spans
 * from scripts/voice.mjs) and the frame it starts on in the film.
 */
export const VOICE_AT: Record<keyof typeof take, number> = {
  intro: s(0.3),
  build: s(7.3),
  review: s(10.9),
  dashboard: s(15),
  card: s(22.2),
  sponsors: s(27.3),
  end: s(33.9),
};

/** In-scene beats the music and sound effects answer (frames, absolute). */
export const BEAT = {
  pasteClick: SCENE.intro.from + 120,
  goClick: SCENE.intro.from + 186,
  approved: SCENE.work.from + 186,
  chevronClick: SCENE.dashboard.from + 28,
  mergeClick: SCENE.dashboard.from + 140,
  merged: SCENE.dashboard.from + 154,
  githubClick: SCENE.dashboard.from + 192,
  climb: SCENE.sponsors.from + 140,
};

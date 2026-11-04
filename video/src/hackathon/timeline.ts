import take from "./take.json";
import voice from "./voice.json";

/**
 * The hackathon film as beats: each holds one line of the script on its
 * view, as long as the line takes (or the view needs). The landing take
 * (public/hackathon/landing.mp4) plays from `rec` and freezes once its `len`
 * is used up. Times are in seconds; the film is built at 30 fps.
 */
export const FPS = 30;

export type LineId = keyof typeof voice;
export const line = (id: LineId) => voice[id];

/** Where the camera looks on the 1920×1080 take: a point and a zoom. */
export type Cam = { x: number; y: number; s: number };
export const CAM = {
  list: { x: 960, y: 470, s: 1.3 },
  run: { x: 960, y: 600, s: 1.12 },
  room: { x: 975, y: 385, s: 1.58 },
  roomWide: { x: 975, y: 420, s: 1.3 },
  merge: { x: 960, y: 520, s: 1.15 },
} satisfies Record<string, Cam>;

export type View =
  | { kind: "face"; overlay?: "name" | "solved" | "volume" | "review" | "hands" | "show" | "given" | "fast" }
  | { kind: "logo"; end?: boolean }
  | { kind: "setup" }
  | {
      kind: "take";
      rec: number;
      len?: number;
      rate?: number;
      cam: [Cam, Cam];
      bubble?: boolean;
      stamp?: string;
      diffAfter?: number;
      film?: { at: number; src: string; length: number };
      chip?: string;
    }
  | { kind: "diff"; dim?: boolean }
  | { kind: "statement"; text: string }
  | { kind: "preview" };

type BeatSpec = { id: string; say?: LineId; at?: number; min?: number; view: View };

const m = take.moments;
const PAD = 0.2;

const SPECS: BeatSpec[] = [
  { id: "hi", say: "hi", view: { kind: "face", overlay: "name" } },
  { id: "solved", say: "solved", view: { kind: "face", overlay: "solved" } },
  { id: "volume", say: "volume", view: { kind: "face", overlay: "volume" } },
  { id: "review", say: "review", view: { kind: "face", overlay: "review" } },
  { id: "hands", say: "hands", view: { kind: "face", overlay: "hands" } },
  { id: "yarrow", say: "yarrow", at: 0.3, min: 3.4, view: { kind: "logo" } },
  { id: "show", say: "show", view: { kind: "face", overlay: "show" } },
  { id: "setup", say: "setup", view: { kind: "setup" } },
  { id: "dashboard", say: "dashboard", view: { kind: "take", rec: m.loaded + 0.3, len: m.start_reach - m.loaded - 0.4, cam: [CAM.list, CAM.list], bubble: true } },
  { id: "pick", say: "pick", view: { kind: "take", rec: m.start_reach - 0.1, len: 0.1, cam: [CAM.list, { ...CAM.list, s: 1.45, y: 450 }], bubble: true } },
  {
    id: "start",
    say: "start",
    at: 0.2,
    view: { kind: "take", rec: m.start_reach, len: m.to_review - m.start_reach, rate: 1.45, cam: [{ ...CAM.list, s: 1.45, y: 450 }, CAM.run], bubble: true },
  },
  {
    id: "later",
    say: "later",
    view: { kind: "take", rec: m.to_review, len: 2.4, cam: [CAM.run, CAM.run], stamp: "7 minutes later", diffAfter: 2.2, bubble: true },
  },
  { id: "instead", say: "instead", at: 0.5, min: 1.9, view: { kind: "diff", dim: true } },
  { id: "shows", say: "shows", at: 0.1, min: 1.7, view: { kind: "take", rec: m.room - 0.2, cam: [CAM.roomWide, CAM.room] } },
  {
    id: "demo",
    min: 8.5,
    view: {
      kind: "take",
      rec: m.room - 0.2 + 1.7,
      cam: [CAM.room, CAM.room],
      film: { at: m.play + 0.35 - (m.room - 0.2 + 1.7), src: "hackathon/film/3bce034d-01.mp3", length: 17 },
    },
  },
  { id: "q1", say: "q1", view: { kind: "take", rec: m.q1_type, len: m.q1_send - m.q1_type + 0.3, cam: [CAM.room, CAM.room] } },
  { id: "a1", say: "a1", at: 0.9, view: { kind: "take", rec: m.q1_send + 0.3, len: m.q2_type - m.q1_send - 0.3, cam: [CAM.room, CAM.room], chip: "Muse Spark" } },
  { id: "q2", say: "q2", view: { kind: "take", rec: m.q2_type, len: m.q2_send - m.q2_type + 0.3, cam: [CAM.room, CAM.room] } },
  { id: "a2", say: "a2", at: 0.8, view: { kind: "take", rec: m.q2_send + 0.3, len: m.q2_done - m.q2_send, cam: [CAM.room, CAM.room], chip: "Muse Spark" } },
  { id: "create", say: "create", at: 1.9, view: { kind: "take", rec: m.q2_done, len: m.merge_reach - m.q2_done, cam: [CAM.room, CAM.roomWide] } },
  { id: "spark", say: "spark", view: { kind: "take", rec: m.merge_reach - 0.05, len: 0.05, cam: [CAM.roomWide, { ...CAM.roomWide, s: 1.2 }], bubble: true, chip: "Muse Spark · live" } },
  { id: "conversation", say: "conversation", at: 0.2, min: 3.8, view: { kind: "statement", text: "Code review, as a conversation." } },
  { id: "preview", say: "preview", view: { kind: "preview" } },
  { id: "merge", say: "merge", at: 0.2, view: { kind: "take", rec: m.merge_reach - 0.6, len: m.end - m.merge_reach + 0.6, cam: [CAM.roomWide, CAM.merge], bubble: true } },
  { id: "given", say: "given", view: { kind: "face", overlay: "given" } },
  { id: "fast", say: "fast", view: { kind: "face", overlay: "fast" } },
  { id: "try", say: "try", at: 0.3, min: 4.2, view: { kind: "logo", end: true } },
];

export type Beat = BeatSpec & { from: number; duration: number };

export const BEATS: Beat[] = [];
let cursor = 0;
for (const spec of SPECS) {
  const spoken = spec.say ? (spec.at ?? 0) + line(spec.say).duration + PAD : 0;
  const duration = Math.max(spec.min ?? 0, spoken);
  BEATS.push({ ...spec, from: cursor, duration });
  cursor += duration;
}
export const TOTAL_SECONDS = cursor;
export const TOTAL = Math.ceil(cursor * FPS);
export const f = (seconds: number) => Math.round(seconds * FPS);

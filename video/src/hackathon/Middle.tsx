import { Audio, Video } from "@remotion/media";
import { AbsoluteFill, interpolate, staticFile, useCurrentFrame } from "remotion";
import { c, clamp, ease, font } from "../theme";
import cut from "./middle-cut.json";

/**
 * The film's middle on the real screen share: the rush cut by scripts/edit-rush.py
 * (public/rush/middle-screen.mp4, middle-cam.mp4, middle-mix.wav, kept out of git),
 * the camera moving to what is said, Kevin in a bubble, and the wait as a time-lapse.
 */
export const MIDDLE_FRAMES = cut.frames;

type Cam = { x: number; y: number; s: number };
/** Where the camera looks on the 1920×1080 screen: barely, the app is already zoomed in the take. */
const CAMS: Record<string, Cam> = {
  full: { x: 960, y: 540, s: 1 },
  landing: { x: 960, y: 540, s: 1 },
  dash: { x: 960, y: 540, s: 1 },
  modalChat: { x: 1390, y: 570, s: 1.06 },
  modal: { x: 960, y: 540, s: 1 },
  working: { x: 1000, y: 600, s: 1.04 },
  room: { x: 960, y: 540, s: 1 },
  demo: { x: 712, y: 613, s: 1.08 },
};

/** Keeps the view inside the screen. */
const fit = ({ x, y, s }: Cam): Cam => ({
  s,
  x: Math.min(Math.max(x, 960 / s), 1920 - 960 / s),
  y: Math.min(Math.max(y, 540 / s), 1080 - 540 / s),
});

const MOVE = 20;

const camAt = (frame: number): Cam => {
  const segs = cut.segments;
  const i = Math.max(0, segs.findIndex((s) => frame < s.to));
  const seg = segs[i] ?? segs[segs.length - 1]!;
  const now = fit(CAMS[seg.cam ?? "full"]!);
  const prev = i > 0 ? fit(CAMS[segs[i - 1]!.cam ?? "full"]!) : now;
  const k = interpolate(frame, [seg.from, seg.from + MOVE], [0, 1], { ...clamp, easing: ease.inOut });
  return { x: prev.x + (now.x - prev.x) * k, y: prev.y + (now.y - prev.y) * k, s: prev.s + (now.s - prev.s) * k };
};

export const Middle: React.FC = () => {
  const frame = useCurrentFrame();
  const { x, y, s } = camAt(frame);
  return (
    <AbsoluteFill style={{ background: c.bg, fontFamily: font.sans, color: c.text }}>
      <AbsoluteFill style={{ transformOrigin: "0 0", transform: `translate(${960 - x * s}px, ${540 - y * s}px) scale(${s})` }}>
        <Video src={staticFile("rush/middle-screen.mp4")} muted />
      </AbsoluteFill>
      <TimeLapse />
      <Trackers />
      <Bubble />
      <Audio src={staticFile("rush/middle-mix.wav")} />
    </AbsoluteFill>
  );
};

/** Kevin, live, in a bubble: away while the agent works alone. */
const Bubble: React.FC = () => {
  const frame = useCurrentFrame();
  const away = cut.segments.filter((s) => "bubble" in s && s.bubble === false);
  const o = Math.min(...away.map((s) => interpolate(frame, [s.from - 8, s.from, s.to, s.to + 8], [1, 0, 0, 1], clamp)), 1);
  return (
  <div
    style={{
      opacity: o,
      transform: `scale(${0.9 + 0.1 * o})`,
      position: "absolute",
      left: 28,
      bottom: 28,
      width: 236,
      height: 236,
      borderRadius: 999,
      overflow: "hidden",
      border: `3px solid rgba(255,255,255,.14)`,
      boxShadow: "0 18px 50px rgba(0,0,0,.55)",
      background: c.elevated,
    }}
  >
    <Video src={staticFile("rush/middle-cam.mp4")} muted style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scale(1.35)", transformOrigin: "50% 38%" }} />
  </div>
  );
};

/** The wait, counted: Muse Wonder's minutes run past in a few seconds. */
const TimeLapse: React.FC = () => {
  const frame = useCurrentFrame();
  const seg = cut.segments.find((s) => "label" in s && s.label === "timelapse") as
    | { from: number; to: number; src: number[]; since: number }
    | undefined;
  if (!seg) return null;
  const hold = 40;
  if (frame < seg.from - 6 || frame > seg.to + hold) return null;
  const real = interpolate(frame, [seg.from, seg.to], [seg.src[0]! - seg.since, seg.src[1]! - seg.since], clamp);
  const o = interpolate(frame, [seg.from - 6, seg.from + 4, seg.to + hold - 10, seg.to + hold], [0, 1, 1, 0], clamp);
  const m = Math.floor(real / 60);
  const sec = Math.floor(real % 60);
  return (
    <div style={{ position: "absolute", top: 40, left: 0, right: 0, display: "flex", justifyContent: "center", opacity: o }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
          padding: "16px 30px",
          borderRadius: 999,
          background: "rgba(17,18,21,.92)",
          border: `1px solid ${c.line}`,
          boxShadow: "0 18px 50px rgba(0,0,0,.5)",
          fontSize: 34,
        }}
      >
        <span style={{ width: 14, height: 14, borderRadius: 99, background: c.amber, boxShadow: `0 0 16px ${c.amber}` }} />
        <span style={{ color: c.secondary }}>Muse Wonder at work</span>
        <span style={{ fontFamily: font.mono, fontVariantNumeric: "tabular-nums", minWidth: 110, textAlign: "right" }}>
          {m}:{String(sec).padStart(2, "0")}
        </span>
      </div>
    </div>
  );
};

/** A word heard in the middle, the first one at or after a time (in seconds). */
const heard = (text: string, after = 0) => {
  const words = cut.words as [string, number, string][];
  const hit = words.find(([w, t]) => w.toLowerCase().replace(/[^a-z0-9-]/g, "") === text && t >= after);
  if (!hit) throw new Error(`"${text}" is not heard in the middle`);
  return Math.round(hit[1] * 30);
};

/** Where the tickets come from, as Kevin names them. */
const Trackers: React.FC = () => {
  const frame = useCurrentFrame();
  const seg = cut.segments.find((s) => "callout" in s && s.callout === "trackers");
  if (!seg) return null;
  const from = seg.from / 30;
  const pills: [string, string, number][] = [
    ["GitHub Issues", "#edeef0", heard("is-issues", from)],
    ["Jira", "#2684ff", heard("jira", from)],
    ["Linear", "#8b93ff", heard("linear", from)],
    ["Trello", "#3d9be9", heard("trello", from)],
  ];
  const start = pills[0]![2] - 12;
  const end = seg.to + 6;
  if (frame < start - 2 || frame > end + 12) return null;
  const o = interpolate(frame, [start, start + 10, end, end + 12], [0, 1, 1, 0], clamp);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 640, display: "flex", justifyContent: "center", opacity: o }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 22,
          padding: "26px 34px",
          borderRadius: 26,
          background: "rgba(17,18,21,.94)",
          border: `1px solid ${c.line}`,
          boxShadow: "0 24px 70px rgba(0,0,0,.5)",
        }}
      >
        <span style={{ fontSize: 32, color: c.muted, marginRight: 6 }}>Tickets from</span>
        {pills.map(([name, color, at]) => {
          const k = interpolate(frame, [at - 4, at + 8], [0, 1], { ...clamp, easing: ease.enter });
          return (
            <span
              key={name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 22px",
                borderRadius: 999,
                border: `1px solid ${c.line}`,
                background: c.elevated,
                fontSize: 32,
                opacity: k,
                transform: `translateY(${(1 - k) * 14}px)`,
              }}
            >
              <span style={{ width: 14, height: 14, borderRadius: 99, background: color }} />
              {name}
            </span>
          );
        })}
      </div>
    </div>
  );
};

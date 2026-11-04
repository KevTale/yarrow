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
/** Where the camera looks on the 1920×1080 screen. */
const CAMS: Record<string, Cam> = {
  full: { x: 960, y: 540, s: 1 },
  landing: { x: 900, y: 470, s: 1.08 },
  dash: { x: 940, y: 470, s: 1.15 },
  modalChat: { x: 1390, y: 570, s: 1.4 },
  modal: { x: 944, y: 572, s: 1.12 },
  working: { x: 1000, y: 600, s: 1.15 },
  room: { x: 935, y: 610, s: 1.15 },
  demo: { x: 712, y: 613, s: 1.5 },
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

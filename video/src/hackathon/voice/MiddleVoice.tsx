import { Audio, Video } from "@remotion/media";
import { AbsoluteFill, interpolate, staticFile, useCurrentFrame } from "remotion";
import { c, clamp, ease, font } from "../../theme";
import cut from "./cut.json";
import takes from "./takes.json";

/**
 * The cloned-voice film's middle: the screen of the screen-share rush cut by
 * scripts/edit-voice.py (public/rush/voice-screen.mp4 and voice-mix.wav, kept out
 * of git), full frame, under Kevin's cloned voice and the agent's own words, the
 * wait as a time-lapse. No camera move: the app is already zoomed in the take.
 */
export const MIDDLE_VOICE_FRAMES = cut.frames;
const FPS = 30;

type Beat = { id: string; start: number; frames: number; src: number[]; say?: string; at?: number; since?: number };
const beats = cut.beats as Beat[];
const lines = takes as unknown as Record<string, { words: [string, number, number][] }>;

const beat = (id: string) => {
  const hit = beats.find((b) => b.id === id);
  if (!hit) throw new Error(`no "${id}" beat in the middle`);
  return hit;
};

/** The frame a cloned word starts on: the nth time it is said in its beat's line. */
const said = (id: string, text: string, nth = 0) => {
  const b = beat(id);
  const hit = lines[b.say!]!.words.filter(([w]) => w.replace(/[,.?!]+$/, "") === text)[nth];
  if (!hit) throw new Error(`"${text}" #${nth} is not said in "${id}"`);
  return b.start + Math.round(((b.at ?? 0) + hit[1]) * FPS);
};

export const MiddleVoice: React.FC = () => (
  <AbsoluteFill style={{ background: c.bg, fontFamily: font.sans, color: c.text }}>
    <Video src={staticFile("rush/voice-screen.mp4")} muted />
    <Trackers />
    <TimeLapse />
    <Audio src={staticFile("rush/voice-mix.wav")} />
  </AbsoluteFill>
);

/** The wait, counted: Muse Wonder's minutes run past in a few seconds. */
const TimeLapse: React.FC = () => {
  const frame = useCurrentFrame();
  const b = beat("timelapse");
  const from = b.start;
  const to = b.start + b.frames;
  const hold = 40;
  if (frame < from - 6 || frame > to + hold) return null;
  const real = interpolate(frame, [from, to], [b.src[0]! - b.since!, b.src[1]! - b.since!], clamp);
  const o = interpolate(frame, [from - 6, from + 4, to + hold - 10, to + hold], [0, 1, 1, 0], clamp);
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

/** Where the tickets come from, each as the voice names it. */
const Trackers: React.FC = () => {
  const frame = useCurrentFrame();
  const pills: [string, string, number][] = [
    ["GitHub Issues", "#edeef0", said("dashboard", "GitHub", 1)],
    ["Jira", "#2684ff", said("dashboard", "Jira")],
    ["Linear", "#8b93ff", said("dashboard", "Linear")],
    ["Trello", "#3d9be9", said("dashboard", "Trello")],
  ];
  const start = pills[0]![2] - 12;
  const end = said("dashboard", "so");
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

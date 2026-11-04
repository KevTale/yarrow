import { Audio, Video } from "@remotion/media";
import { AbsoluteFill, Easing, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { c, clamp, ease, font } from "../theme";
import { Big, Logo, Rise, Source } from "./Hackathon";
import cut from "./intro-cut.json";

/**
 * The film's intro on the real face cam: the rush cut and sped up by
 * scripts/cut-rush.py (public/rush/intro-cam.mp4 and intro-voice.wav, kept
 * out of git), its numbers drawn beside Kevin as he says them, and the logo
 * on "Yarrow comes in".
 */
const FPS = 30;
const f = (s: number) => Math.round(s * FPS);
const words = cut.words as [string, number, number][];

/** The frame a word starts on: the nth time it is said. */
const at = (text: string, nth = 0) => {
  const hits = words.filter(([w]) => w.replace(/[,.?!]+$/, "") === text);
  const hit = hits[nth];
  if (!hit) throw new Error(`"${text}" #${nth} is not said in the intro`);
  return f(hit[1]);
};
const end = (text: string, nth = 0) => {
  const hits = words.filter(([w]) => w.replace(/[,.?!]+$/, "") === text);
  return f(hits[nth]![2]);
};

const LOGO = at("Yarrow", 1) - 2;
export const INTRO_FRAMES = f(cut.duration) + 50;

/** Each panel beside Kevin: when it opens, when it closes. */
const PANELS = {
  github: [at("Two") - 4, at("But") - 8],
  features: [at("But") + 2, at("pull", 1) - 12],
  faros: [at("pull", 1) - 6, at("Agents") + 14],
  jam: [at("Agents") + 14, at("That's", 1) + 4],
} as const;

export const Intro: React.FC = () => (
  <AbsoluteFill style={{ background: c.bg, fontFamily: font.sans, color: c.text }}>
    <Cam />
    <Sequence from={at("Hi")} durationInFrames={at("Two") - at("Hi")} name="name">
      <Name />
    </Sequence>
    {Object.entries(PANELS).map(([id, [from, to]]) => (
      <Sequence key={id} from={from} durationInFrames={to - from} name={id}>
        <Panel length={to - from}>
          {id === "github" && <GitHub from={from} />}
          {id === "features" && <Features from={from} />}
          {id === "faros" && <Faros from={from} />}
          {id === "jam" && <Jam from={from} />}
        </Panel>
      </Sequence>
    ))}
    <Sequence from={LOGO} name="logo">
      <LogoIn />
    </Sequence>
    <Audio src={staticFile("rush/intro-voice.wav")} />
  </AbsoluteFill>
);

/* ---------- The face cam ---------- */

/** Kevin, punched in a little on every other cut so the cuts read as chosen, and pushed in on the closing line. */
const Cam: React.FC = () => {
  const frame = useCurrentFrame();
  const piece = cut.cuts.filter((t) => f(t) <= frame).length;
  const close = interpolate(frame, [at("That's", 1) - 10, LOGO], [0, 0.06], { ...clamp, easing: ease.inOut });
  const scale = (piece % 2 ? 1.08 : 1) + close;
  const out = interpolate(frame, [LOGO, LOGO + 12], [0, 1], { ...clamp, easing: ease.inOut });
  return (
    <AbsoluteFill style={{ filter: `blur(${out * 18}px) brightness(${1 - out * 0.75})` }}>
      <AbsoluteFill style={{ transformOrigin: "1330px 330px", transform: `scale(${scale})` }}>
        <Video src={staticFile("rush/intro-cam.mp4")} muted />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Name: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = spring({ frame: frame - (at("Kevin") - at("Hi")), fps, config: { damping: 200 }, durationInFrames: 16 });
  const out = interpolate(frame, [at("Two") - at("Hi") - 10, at("Two") - at("Hi")], [1, 0], clamp);
  return (
    <div
      style={{
        position: "absolute",
        left: 96,
        bottom: 170,
        display: "flex",
        alignItems: "center",
        gap: 26,
        padding: "24px 40px 24px 28px",
        borderRadius: 26,
        background: "rgba(12,13,15,.78)",
        backdropFilter: "blur(18px)",
        border: `1px solid ${c.line}`,
        opacity: k * out,
        transform: `translateX(${(1 - k) * -40}px)`,
      }}
    >
      <Img src={staticFile("yarrow-mark-on-dark.svg")} style={{ width: 72, height: 72 }} />
      <div>
        <div style={{ fontFamily: font.display, fontSize: 54, lineHeight: 1 }}>Kevin</div>
        <div style={{ fontSize: 28, color: c.secondary, marginTop: 8 }}>Founder, Yarrow</div>
      </div>
    </div>
  );
};

/* ---------- Panels beside Kevin ---------- */

export const Panel: React.FC<{ length: number; children: React.ReactNode }> = ({ length, children }) => {
  const frame = useCurrentFrame();
  const k = interpolate(frame, [0, 14], [0, 1], { ...clamp, easing: ease.enter });
  const out = interpolate(frame, [length - 10, length], [1, 0], { ...clamp, easing: ease.inOut });
  return (
    <div
      style={{
        position: "absolute",
        left: 80,
        top: 110,
        width: 820,
        padding: "56px 64px 60px",
        borderRadius: 36,
        background: "rgba(12,13,15,.84)",
        backdropFilter: "blur(24px)",
        border: `1px solid ${c.line}`,
        boxShadow: "0 30px 90px rgba(0,0,0,.35)",
        overflow: "hidden",
        opacity: k * out,
        transform: `translateX(${(1 - k) * -60 + (1 - out) * -30}px) scale(${0.97 + 0.03 * k})`,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {children}
    </div>
  );
};

/** 400M merged pull requests in 2024, 1.3B in 2026: ×3. */
const GitHub: React.FC<{ from: number }> = ({ from }) => {
  const frame = useCurrentFrame() + from;
  const now = interpolate(frame, [at("1.3"), end("billion") + 6], [0, 1.3], { ...clamp, easing: Easing.out(Easing.cubic) });
  const then = interpolate(frame, [at("four"), end("million") + 4], [0, 400], { ...clamp, easing: Easing.out(Easing.cubic) });
  const bar = (year: string, show: number, value: number, max: number, label: string, color: string) => (
    <Rise at={show - from} style={{ marginTop: 34 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontSize: 30, color: c.muted }}>{year}</div>
        <div style={{ fontFamily: font.display, fontSize: 64, color, opacity: value > 0 ? 1 : 0 }}>{label}</div>
      </div>
      <div style={{ height: 22, marginTop: 12, borderRadius: 99, background: c.lineSoft, overflow: "hidden" }}>
        <div style={{ width: `${(value / max) * 100}%`, height: "100%", borderRadius: 99, background: color }} />
      </div>
    </Rise>
  );
  return (
    <>
      <Rise at={4}>
        <Big size={40} color={c.secondary}>Pull requests merged on GitHub</Big>
      </Rise>
      {bar("2024", at("Two") + 2, then, 1300, `${Math.round(then)}M`, c.muted)}
      {bar("2026", at("This") - 4, now, 1.3, `${now.toFixed(1)}B`, c.text)}
      <Rise at={at("three") - from} style={{ marginTop: 44 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 28 }}>
          <Big size={170} color={c.amber}>×3</Big>
          <Big size={44} color={c.secondary}>in two years</Big>
        </div>
        <Source>GitHub Octoverse</Source>
      </Rise>
    </>
  );
};

/** "3× more features in production?" struck through on "not really". */
const Features: React.FC<{ from: number }> = ({ from }) => {
  const frame = useCurrentFrame() + from;
  const struck = (text: string, delay: number) => {
    const k = interpolate(frame, [at("not") + delay, at("not") + delay + 9], [0, 1], { ...clamp, easing: ease.enter });
    return (
      <div style={{ position: "relative", alignSelf: "flex-start" }}>
        <div style={{ whiteSpace: "nowrap" }}>
          <Big size={84} color={k > 0.5 ? c.muted : c.text}>{text}</Big>
        </div>
        <div style={{ position: "absolute", left: -10, top: "54%", height: 9, width: `calc((100% + 20px) * ${k})`, borderRadius: 99, background: c.red }} />
      </div>
    );
  };
  return (
    <>
      <Rise at={4} style={{ display: "flex", flexDirection: "column" }}>
        {struck("3× more features", 0)}
        {struck("in production?", 6)}
      </Rise>
      <Rise at={at("not") - from + 8} style={{ marginTop: 34 }}>
        <Big size={64} color={c.red}>Not really.</Big>
      </Rise>
    </>
  );
};

/** Faros AI: 5× longer in review. */
const Faros: React.FC<{ from: number }> = ({ from }) => {
  const frame = useCurrentFrame() + from;
  const times = interpolate(frame, [at("five"), end("times", 2) + 4], [1, 5], { ...clamp, easing: Easing.out(Easing.cubic) });
  return (
    <>
      <Rise at={4}>
        <Big size={40} color={c.muted}>Faros AI study</Big>
      </Rise>
      <Rise at={4} style={{ marginTop: 14 }}>
        <Big size={52} color={c.secondary}>Time a pull request sits in review</Big>
      </Rise>
      <Rise at={at("five") - from - 2} style={{ marginTop: 10 }}>
        <Big size={300} color={c.amber}>{Math.round(times)}×</Big>
      </Rise>
      <Rise at={at("longer") - from - 4}>
        <Big size={72}>longer than before</Big>
      </Rise>
    </>
  );
};

const TITLES = [
  "Add due dates to tasks",
  "Fix the login redirect",
  "Paginate the task list",
  "Dark mode toggle",
  "Bump dependencies",
  "Refactor the task store",
  "Add a priority field",
  "Fix a flaky test",
  "Export tasks as CSV",
  "Search by keyword",
  "Keyboard shortcuts",
  "Drag to reorder",
];

/** Pull requests piling up in review until it jams. */
const Jam: React.FC<{ from: number }> = ({ from }) => {
  const frame = useCurrentFrame() + from;
  const { fps } = useVideoConfig();
  const first = at("ship");
  const jam = at("traffic");
  const every = Math.max(3, Math.floor((jam - first) / TITLES.length));
  const arrived = TITLES.map((_, i) => first + i * every).filter((t) => t <= frame);
  const count = Math.round(interpolate(frame, [first, jam + 8], [12, 148], { ...clamp, easing: Easing.in(Easing.quad) }));
  const jammed = interpolate(frame, [jam, jam + 6], [0, 1], clamp);
  const shake = frame >= jam && frame < jam + 12 ? Math.sin((frame - jam) * 2.4) * 6 * (1 - (frame - jam) / 12) : 0;
  return (
    <>
      <Rise at={2}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <Big size={40} color={c.secondary}>Waiting for review</Big>
          <Big size={64} color={jammed > 0.5 ? c.red : c.amber}>{count}</Big>
        </div>
      </Rise>
      <div style={{ position: "relative", height: 520, marginTop: 28, overflow: "hidden", transform: `translateX(${shake}px)` }}>
        {arrived.map((t, i) => {
          const k = spring({ frame: frame - t, fps, config: { damping: 16, stiffness: 160 } });
          const depth = arrived.length - 1 - i;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: depth * 74 + (1 - k) * -70,
                opacity: Math.min(k, 1) * (1 - depth * 0.07),
                display: "flex",
                alignItems: "center",
                gap: 18,
                padding: "16px 24px",
                borderRadius: 16,
                background: c.elevated,
                border: `1px solid ${jammed > 0.5 ? "rgba(238,123,110,.55)" : c.line}`,
                fontSize: 28,
              }}
            >
              <span style={{ width: 14, height: 14, borderRadius: 99, background: jammed > 0.5 ? c.red : c.amber }} />
              <span style={{ fontFamily: font.mono, color: c.muted }}>#{148 + i}</span>
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{TITLES[i]}</span>
            </div>
          );
        })}
      </div>
    </>
  );
};

/* ---------- The logo ---------- */

const LogoIn: React.FC = () => {
  const frame = useCurrentFrame();
  const k = interpolate(frame, [0, 12], [0, 1], { ...clamp, easing: ease.inOut });
  return (
    <AbsoluteFill style={{ opacity: k }}>
      <Logo />
    </AbsoluteFill>
  );
};

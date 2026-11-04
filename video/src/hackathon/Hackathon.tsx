import { Audio, Video } from "@remotion/media";
import {
  AbsoluteFill,
  Easing,
  Freeze,
  Img,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { c, clamp, ease, font } from "../theme";
import files from "../../public/hackathon/film/files.json";
import { BEATS, f, FPS, line, type Beat, type Cam, type LineId, type View } from "./timeline";

/**
 * The hackathon film's test cut: the script read by ElevenLabs voices over
 * a real take of yarrow.run's landing. The face cam is a placeholder, and so
 * are the two screens the landing cannot show (setup and preview).
 */
export const Hackathon: React.FC = () => (
  <AbsoluteFill style={{ background: c.bg, fontFamily: font.sans, color: c.text }}>
    {BEATS.map((beat) => (
      <Sequence key={beat.id} from={f(beat.from)} durationInFrames={f(beat.duration)} name={beat.id}>
        <Scene beat={beat} />
        {beat.say && (
          <Sequence from={f(beat.at ?? 0)} name={`voice ${beat.say}`}>
            <Audio src={staticFile(`hackathon/voice/${beat.say}.mp3`)} volume={line(beat.say).by === "agent" ? 1 : 0.95} />
            <Caption id={beat.say} />
          </Sequence>
        )}
      </Sequence>
    ))}
  </AbsoluteFill>
);

const Scene: React.FC<{ beat: Beat }> = ({ beat }) => {
  const view = beat.view;
  switch (view.kind) {
    case "face":
      return <Face overlay={view.overlay} beat={beat} />;
    case "logo":
      return <Logo end={view.end} />;
    case "setup":
      return <Setup />;
    case "take":
      return <Take view={view} duration={beat.duration} />;
    case "diff":
      return <Diff dim={view.dim} />;
    case "statement":
      return <Statement text={view.text} />;
    case "preview":
      return <Preview />;
  }
};

/* ---------- The landing take ---------- */

const Take: React.FC<{ view: Extract<View, { kind: "take" }>; duration: number }> = ({ view, duration }) => {
  const frame = useCurrentFrame();
  const rate = view.rate ?? 1;
  const playFrames = view.len === undefined ? Infinity : f(view.len / rate);
  const diffFrom = view.diffAfter === undefined ? Infinity : f(view.diffAfter);
  const k = interpolate(frame, [0, f(duration)], [0, 1], { ...clamp, easing: ease.inOut });
  const cam = mix(view.cam[0], view.cam[1], k);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transformOrigin: "0 0", transform: camera(cam) }}>
        <Freeze frame={Number.isFinite(playFrames) ? playFrames : 0} active={(at) => at >= playFrames}>
          <Video src={staticFile("hackathon/landing.mp4")} trimBefore={f(view.rec)} playbackRate={rate} muted />
        </Freeze>
      </AbsoluteFill>
      {view.film && (
        <Sequence from={Math.max(0, f(view.film.at))}>
          <Audio
            src={staticFile(view.film.src)}
            volume={(at) => interpolate(at, [f(duration - view.film!.at) - 18, f(duration - view.film!.at)], [1, 0], clamp)}
          />
        </Sequence>
      )}
      {view.stamp && <Stamp text={view.stamp} />}
      {view.chip && <Chip text={view.chip} />}
      {view.bubble && <Bubble />}
      {frame >= diffFrom && (
        <Sequence from={diffFrom}>
          <Diff />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};

const mix = (a: Cam, b: Cam, k: number): Cam => ({
  x: a.x + (b.x - a.x) * k,
  y: a.y + (b.y - a.y) * k,
  s: a.s + (b.s - a.s) * k,
});
const camera = ({ x, y, s }: Cam) => `translate(${960 - x * s}px, ${540 - y * s}px) scale(${s})`;

const Stamp: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 8, 50, 62], [0, 1, 1, 0], clamp);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", background: `rgba(8,9,11,${0.55 * o})` }}>
      <div style={{ opacity: o, fontFamily: font.display, fontSize: 64, letterSpacing: -1 }}>{text}</div>
    </AbsoluteFill>
  );
};

const Chip: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [6, 16], [0, 1], clamp);
  return (
    <div
      style={{
        position: "absolute",
        top: 48,
        left: 64,
        opacity: o,
        transform: `translateY(${(1 - o) * -10}px)`,
        padding: "12px 22px",
        borderRadius: 999,
        background: "rgba(17,18,21,.88)",
        border: `1px solid ${c.line}`,
        fontSize: 28,
        display: "flex",
        gap: 12,
        alignItems: "center",
      }}
    >
      <span style={{ width: 12, height: 12, borderRadius: 99, background: c.green, boxShadow: `0 0 14px ${c.green}` }} />
      {text}
    </div>
  );
};

/** Where the webcam will sit over the screen. */
const Bubble: React.FC = () => (
  <div
    style={{
      position: "absolute",
      right: 48,
      bottom: 150,
      width: 230,
      height: 230,
      borderRadius: 999,
      overflow: "hidden",
      border: `3px solid ${c.line}`,
      background: "linear-gradient(160deg, #23262c, #121317)",
      boxShadow: "0 20px 60px rgba(0,0,0,.5)",
    }}
  >
    <Person scale={0.42} />
    <div style={{ position: "absolute", bottom: 26, width: "100%", textAlign: "center", fontSize: 18, color: c.muted, letterSpacing: 2 }}>
      WEBCAM
    </div>
  </div>
);

/* ---------- Face cam and its words ---------- */

const Person: React.FC<{ scale: number }> = ({ scale }) => (
  <svg viewBox="0 0 400 400" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
    <g transform={`translate(200 ${210 + (1 - scale) * 20}) scale(${scale * 2.2}) translate(-200 -200)`} fill="#2c3037">
      <circle cx="200" cy="150" r="62" />
      <path d="M90 330c10-70 58-104 110-104s100 34 110 104z" />
    </g>
  </svg>
);

const Face: React.FC<{ overlay?: Extract<View, { kind: "face" }>["overlay"]; beat: Beat }> = ({ overlay, beat }) => (
  <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 35%, #1a1c21 0%, #0c0d0f 70%)" }}>
    <AbsoluteFill style={{ opacity: 0.3 }}>
      <Person scale={0.8} />
    </AbsoluteFill>
    <div style={{ position: "absolute", top: 40, left: 48, fontSize: 20, letterSpacing: 3, color: c.muted }}>
      FACE CAM · KEVIN
    </div>
    {overlay && <FaceWords overlay={overlay} beat={beat} />}
  </AbsoluteFill>
);

/** The frame a word of the beat's line starts on, inside the beat. */
const wordFrame = (beat: Beat, index: number) => {
  const words = line(beat.say!).words as unknown as [string, number][];
  return f((beat.at ?? 0) + words[Math.min(index, words.length - 1)]![1]);
};

const Rise: React.FC<{ at: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ at, children, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = spring({ frame: frame - at, fps, config: { damping: 200 }, durationInFrames: 14 });
  return <div style={{ opacity: k, transform: `translateY(${(1 - k) * 24}px)`, ...style }}>{children}</div>;
};

const Big: React.FC<{ children: React.ReactNode; size?: number; color?: string }> = ({ children, size = 110, color = c.text }) => (
  <div style={{ fontFamily: font.display, fontSize: size, lineHeight: 1.02, letterSpacing: -2, color, textShadow: "0 6px 40px rgba(0,0,0,.6)" }}>
    {children}
  </div>
);

const Source: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 24, color: c.muted, marginTop: 18 }}>{children}</div>
);

const FaceWords: React.FC<{ overlay: NonNullable<Extract<View, { kind: "face" }>["overlay"]>; beat: Beat }> = ({ overlay, beat }) => {
  const at = (i: number) => wordFrame(beat, i);
  const box: React.CSSProperties = { position: "absolute", left: 140, top: 230, right: 140 };
  switch (overlay) {
    case "name":
      return (
        <div style={{ position: "absolute", left: 96, bottom: 200 }}>
          <Rise at={at(1)}>
            <div style={{ fontFamily: font.display, fontSize: 56 }}>Kevin</div>
            <div style={{ fontSize: 28, color: c.secondary }}>Founder, Yarrow</div>
          </Rise>
        </div>
      );
    case "solved":
      return (
        <div style={box}>
          <Rise at={at(9)}>
            <Big size={150}>Coding is solved.</Big>
          </Rise>
        </div>
      );
    case "volume":
      return <Volume beat={beat} />;
    case "review":
      return (
        <div style={box}>
          <Rise at={at(4)}>
            <Big size={78} color={c.secondary}>Teams can't keep up.</Big>
          </Rise>
          <Rise at={at(19)} style={{ marginTop: 36 }}>
            <Big size={220} color={c.amber}>5×</Big>
            <Big size={64}>longer in review</Big>
            <Source>Faros AI, AI Engineering Report 2026</Source>
          </Rise>
        </div>
      );
    case "hands":
      return (
        <div style={{ ...box, display: "flex", gap: 80 }}>
          <Rise at={at(3)} style={{ flex: 1 }}>
            <Big size={40} color={c.muted}>On one hand</Big>
            <Big size={84}>More code than ever</Big>
          </Rise>
          <Rise at={at(11)} style={{ flex: 1 }}>
            <Big size={40} color={c.muted}>On the other</Big>
            <Big size={84} color={c.red}>Not enough review</Big>
          </Rise>
        </div>
      );
    case "show":
      return (
        <div style={box}>
          <Rise at={at(7)}>
            <Big size={96}>From the idea</Big>
          </Rise>
          <Rise at={at(10)}>
            <Big size={96} color={c.amber}>to the merge.</Big>
          </Rise>
        </div>
      );
    case "given":
      return (
        <div style={box}>
          <Rise at={at(1)}>
            <Big size={92}>Agents write the code.</Big>
          </Rise>
          <Rise at={at(14)} style={{ marginTop: 24 }}>
            <Big size={92} color={c.amber}>Your team decides what ships.</Big>
          </Rise>
        </div>
      );
    case "fast":
      return (
        <div style={box}>
          {[
            [6, "A clear ticket in."],
            [11, "A working demo out."],
            [17, "A merge you're sure about."],
          ].map(([word, text], i) => (
            <Rise key={i} at={at(word as number)} style={{ marginTop: i ? 18 : 0 }}>
              <Big size={88} color={i === 2 ? c.amber : c.text}>{text}</Big>
            </Rise>
          ))}
        </div>
      );
  }
};

/** 402M counts up to 1.3B as the line says it. */
const Volume: React.FC<{ beat: Beat }> = ({ beat }) => {
  const frame = useCurrentFrame();
  const start = wordFrame(beat, 3);
  const grow = wordFrame(beat, 14);
  const value = interpolate(frame, [grow, grow + 30], [402, 1300], { ...clamp, easing: Easing.out(Easing.cubic) });
  const shown = value < 1000 ? `${Math.round(value)}M` : `${(value / 1000).toFixed(1)}B`;
  return (
    <div style={{ position: "absolute", left: 140, top: 210, right: 140 }}>
      <Rise at={start}>
        <Big size={44} color={c.muted}>Merged pull requests on GitHub</Big>
        <div style={{ display: "flex", alignItems: "baseline", gap: 40, marginTop: 10 }}>
          <Big size={230}>{shown}</Big>
          <Big size={56} color={c.muted}>{frame < grow ? "2024" : "2026"}</Big>
        </div>
      </Rise>
      <Rise at={wordFrame(beat, 16)}>
        <Big size={64} color={c.amber}>×3 in two years</Big>
        <Source>GitHub Octoverse 2026</Source>
      </Rise>
    </div>
  );
};

/* ---------- Brand moments ---------- */

const Logo: React.FC<{ end?: boolean }> = ({ end }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = spring({ frame: frame - 6, fps, config: { damping: 18, stiffness: 90 } });
  const t = interpolate(frame, [26, 44], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", background: "radial-gradient(ellipse at 50% 45%, #17191d 0%, #0c0d0f 65%)" }}>
      <Img src={staticFile("yarrow-logo-on-dark.svg")} style={{ width: 760, opacity: k, transform: `scale(${0.85 + 0.15 * k})` }} />
      <div style={{ marginTop: 48, opacity: t, transform: `translateY(${(1 - t) * 12}px)`, fontFamily: font.display, fontSize: end ? 72 : 52, color: end ? c.amber : c.secondary }}>
        {end ? "yarrow.run" : "The best ticket harness for your team"}
      </div>
    </AbsoluteFill>
  );
};

const Statement: React.FC<{ text: string }> = ({ text }) => (
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", background: "radial-gradient(ellipse at 50% 45%, #17191d 0%, #0c0d0f 65%)" }}>
    <Rise at={4}>
      <Big size={120}>{text}</Big>
    </Rise>
  </AbsoluteFill>
);

/* ---------- Screens the landing cannot show ---------- */

const Placeholder: React.FC<{ text: string }> = ({ text }) => (
  <div style={{ position: "absolute", top: 40, left: 48, fontSize: 20, letterSpacing: 3, color: c.amber }}>{text}</div>
);

const GITHUB =
  "M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6 0-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.7 1.6.2 2.9.1 3.2.8.8 1.3 1.9 1.3 3.1 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3";
const JIRA =
  "M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.005-1.005zm5.723-5.756H5.736a5.215 5.215 0 0 0 5.215 5.214h2.129v2.058a5.218 5.218 0 0 0 5.215 5.214V6.758a1.001 1.001 0 0 0-1.001-1.001zM23.013 0H11.455a5.215 5.215 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24 12.483V1.005A1.001 1.001 0 0 0 23.013 0Z";

const Setup: React.FC = () => {
  const frame = useCurrentFrame();
  const step = (from: number, icon: string, color: string, title: string, done: string) => {
    const k = interpolate(frame, [from, from + 14], [0, 1], { ...clamp, easing: ease.enter });
    const ok = frame > from + 40;
    return (
      <div style={{ opacity: k, transform: `translateY(${(1 - k) * 30}px)`, width: 560, padding: 40, borderRadius: 24, background: c.surface, border: `1px solid ${ok ? c.green : c.line}` }}>
        <svg viewBox="0 0 24 24" width={72} height={72}>
          <path d={icon} fill={color} />
        </svg>
        <div style={{ fontFamily: font.display, fontSize: 48, marginTop: 24 }}>{title}</div>
        <div style={{ fontSize: 28, marginTop: 10, color: ok ? c.green : c.muted }}>{ok ? done : "Connecting…"}</div>
      </div>
    );
  };
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 60, flexDirection: "row", background: c.bg }}>
      <Placeholder text="PLACEHOLDER · REAL SETUP SCREENS TO RECORD" />
      {step(6, GITHUB, "#edeef0", "Connect GitHub", "acme/tasks connected")}
      <div style={{ fontSize: 60, color: c.muted }}>→</div>
      {step(f(3.6), JIRA, "#2684ff", "Import Jira", "Backlog synced")}
      <Bubble />
    </AbsoluteFill>
  );
};

const Preview: React.FC = () => {
  const frame = useCurrentFrame();
  const k = interpolate(frame, [0, 16], [0, 1], { ...clamp, easing: ease.enter });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", background: c.bg }}>
      <Placeholder text="PLACEHOLDER · OPEN THE APP TO RECORD" />
      <div style={{ opacity: k, transform: `scale(${0.96 + 0.04 * k})`, width: 1400, marginTop: 40, borderRadius: 18, overflow: "hidden", border: `1px solid ${c.line}`, background: c.elevated }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 22px", borderBottom: `1px solid ${c.line}` }}>
          {["#ee7b6e", "#f2b544", "#5ccb95"].map((color) => (
            <span key={color} style={{ width: 14, height: 14, borderRadius: 99, background: color }} />
          ))}
          <div style={{ flex: 1, marginLeft: 18, padding: "10px 20px", borderRadius: 10, background: c.bg, fontFamily: font.mono, fontSize: 24, color: c.secondary }}>
            <span style={{ color: c.green }}>🔒 </span>
            7f3a9c21.yarrow.page<span style={{ color: c.muted }}>/?status=doing</span>
          </div>
        </div>
        {/* The film's own browser bar cropped off: the preview's address is the one above. */}
        <div style={{ height: (900 - 110) * (1400 / 1440), overflow: "hidden" }}>
          <Video src={staticFile("hackathon/film/96ec8659-znaeja-04-after-a-reload.mp4")} muted style={{ width: "100%", display: "block", marginTop: -110 * (1400 / 1440) }} />
        </div>
      </div>
      <Bubble />
    </AbsoluteFill>
  );
};

/** A long diff scrolling past: the real lines of the pull request, again and again. */
const Diff: React.FC<{ dim?: boolean }> = ({ dim }) => {
  const frame = useCurrentFrame();
  const rows = (files as { path: string; lines: { kind: string; text: string }[] }[]).flatMap((file) => [
    { kind: "file", text: file.path },
    ...file.lines,
  ]);
  const all = [...rows, ...rows, ...rows, ...rows];
  const fade = dim ? interpolate(frame, [0, 10], [0.6, 0.15], clamp) : 1;
  return (
    <AbsoluteFill style={{ background: "#0d1117", overflow: "hidden", opacity: fade }}>
      <div style={{ transform: `translateY(${-frame * 34}px)`, padding: "40px 120px", fontFamily: font.mono, fontSize: 26, lineHeight: 1.55, filter: "blur(1.2px)" }}>
        {all.map((row, i) => (
          <div
            key={i}
            style={{
              whiteSpace: "pre",
              color: row.kind === "add" ? "#7ee2a8" : row.kind === "del" ? "#ff9a8f" : row.kind === "file" ? c.text : "#8b949e",
              background: row.kind === "add" ? "rgba(46,160,67,.15)" : row.kind === "del" ? "rgba(248,81,73,.15)" : row.kind === "file" ? "#161b22" : "transparent",
              padding: row.kind === "file" ? "10px 16px" : "0 16px",
              marginTop: row.kind === "file" ? 20 : 0,
            }}
          >
            {row.kind === "add" ? "+ " : row.kind === "del" ? "- " : "  "}
            {row.text}
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", top: 36, right: 48, padding: "10px 18px", borderRadius: 10, background: "#161b22", fontFamily: font.mono, fontSize: 24, color: c.secondary }}>
        Files changed <span style={{ color: "#7ee2a8" }}>+412</span> <span style={{ color: "#ff9a8f" }}>−37</span>
      </div>
    </AbsoluteFill>
  );
};

/* ---------- Captions ---------- */

/** The line under the picture, each word as it is said, Kevin's in white and the agent's in amber. */
const Caption: React.FC<{ id: LineId }> = ({ id }) => {
  const frame = useCurrentFrame();
  const spoken = line(id);
  const words = spoken.words as unknown as [string, number][];
  const now = frame / FPS;
  // The sentence being said: lines are cut after a stop, never under four words.
  const groups: [number, number][] = [];
  let open = 0;
  words.forEach(([word], i) => {
    if ((/[.?!:]$/.test(word) && i + 1 - open >= 4) || i === words.length - 1) {
      groups.push([open, i + 1]);
      open = i + 1;
    }
  });
  const [begin, stop] = groups.filter(([first]) => words[first]![1] <= now + 0.05).at(-1) ?? groups[0]!;
  const tail = f(spoken.duration);
  const o = interpolate(frame, [0, 4, tail - 2, tail + 6], [0, 1, 1, 0], clamp);
  return (
    <div style={{ position: "absolute", bottom: 56, left: 0, right: 0, display: "flex", justifyContent: "center", opacity: o }}>
      <div
        style={{
          maxWidth: 1500,
          padding: "14px 28px",
          borderRadius: 14,
          background: "rgba(8,9,11,.78)",
          fontSize: 40,
          lineHeight: 1.3,
          textAlign: "center",
          color: spoken.by === "agent" ? c.gold : c.text,
        }}
      >
        {words.slice(begin, stop).map(([word, at], i) => (
          <span key={i} style={{ opacity: at <= now + 0.05 ? 1 : 0.28 }}>
            {word}{" "}
          </span>
        ))}
      </div>
    </div>
  );
};

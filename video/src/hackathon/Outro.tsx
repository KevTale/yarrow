import { Audio, Video } from "@remotion/media";
import { AbsoluteFill, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { c, clamp, ease, font } from "../theme";
import { Big, Logo, Rise } from "./Hackathon";
import { Panel } from "./Intro";
import cut from "./outro-cut.json";

/**
 * The film's close on the real face cam (public/rush/outro-cam.mp4 and outro-voice.wav,
 * cut by scripts/cut-rush.py): the two things Yarrow takes on beside Kevin, then the logo
 * and yarrow.run.
 */
const FPS = 30;
const f = (s: number) => Math.round(s * FPS);
const words = cut.words as [string, number, number][];
const at = (text: string, nth = 0) => {
  const hit = words.filter(([w]) => w.replace(/[,.?!]+$/, "") === text)[nth];
  if (!hit) throw new Error(`"${text}" #${nth} is not said in the outro`);
  return f(hit[1]);
};

const LOGO = at("Yarrow", 1) - 4;
export const OUTRO_FRAMES = f(cut.duration) + 75;
const PANEL = [at("bottleneck") - 6, at("That") - 2] as const;

export const Outro: React.FC = () => (
  <AbsoluteFill style={{ background: c.bg, fontFamily: font.sans, color: c.text }}>
    <Cam />
    <Sequence from={PANEL[0]} durationInFrames={PANEL[1] - PANEL[0]} name="bottleneck">
      <Panel length={PANEL[1] - PANEL[0]}>
        <Lines from={PANEL[0]} />
      </Panel>
    </Sequence>
    <Sequence from={LOGO} name="logo">
      <LogoIn />
    </Sequence>
    <Audio src={staticFile("rush/outro-voice.wav")} />
  </AbsoluteFill>
);

const Cam: React.FC = () => {
  const frame = useCurrentFrame();
  const piece = cut.cuts.filter((t) => f(t) <= frame).length;
  const scale = piece % 2 ? 1.08 : 1;
  const out = interpolate(frame, [LOGO, LOGO + 12], [0, 1], { ...clamp, easing: ease.inOut });
  return (
    <AbsoluteFill style={{ filter: `blur(${out * 18}px) brightness(${1 - out * 0.75})` }}>
      <AbsoluteFill style={{ transformOrigin: "1330px 340px", transform: `scale(${scale})` }}>
        <Video src={staticFile("rush/outro-cam.mp4")} muted />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Tomorrow's bottleneck: the right ticket in, a review you can trust out. */
const Lines: React.FC<{ from: number }> = ({ from }) => (
  <>
    <Rise at={4}>
      <Big size={40} color={c.muted}>Tomorrow's real bottleneck</Big>
    </Rise>
    <Rise at={at("writing") - from - 4} style={{ marginTop: 34 }}>
      <Big size={84}>Writing the right ticket.</Big>
    </Rise>
    <Rise at={at("reviewing") - from - 4} style={{ marginTop: 22 }}>
      <Big size={84} color={c.amber}>Reviewing what agents ship.</Big>
    </Rise>
  </>
);

const LogoIn: React.FC = () => {
  const frame = useCurrentFrame();
  const k = interpolate(frame, [0, 12], [0, 1], { ...clamp, easing: ease.inOut });
  return (
    <AbsoluteFill style={{ opacity: k }}>
      <Logo end />
    </AbsoluteFill>
  );
};

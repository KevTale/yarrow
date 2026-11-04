import { Audio, Video } from "@remotion/media";
import { AbsoluteFill, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { c, clamp, ease, font } from "../../theme";
import { Big, Logo, Rise } from "../Hackathon";
import { Panel } from "../Intro";
import cut from "../outro-cut.json";

/**
 * The cloned-voice film's close: Kevin's real face cam from "Yarrow focuses on…"
 * to "…the most efficient way possible." (public/rush/outro-cam.mp4 and
 * outro-voice.wav, between two of their cuts), then the logo and the cloned
 * "That's Yarrow. Try it on yarrow dot run." (public/rush/voice/try.wav).
 */
const FPS = 30;
const f = (s: number) => Math.round(s * FPS);
const words = cut.words as [string, number, number][];
const word = (text: string) => {
  const hit = words.find(([w]) => w.replace(/[,.?!]+$/, "") === text);
  if (!hit) throw new Error(`"${text}" is not said in the outro`);
  return hit;
};

/** The take, from the cut after "As we can see," to the cut before "That was Yarrow". */
const FROM = f(cut.cuts.find((t) => t > word("see")[2])!);
const TO = f(cut.cuts.find((t) => t > word("possible")[2])!);
/** A word's frame in this close. */
const at = (text: string) => f(word(text)[1]) - FROM;

const LOGO = TO - FROM - 4;
const VOICE = LOGO + 6;
const TRY = 101; // public/rush/voice/try.wav, 3.36 s
export const OUTRO_VOICE_FRAMES = VOICE + TRY + 36;
const PANEL = [at("bottleneck") - 6, LOGO + 2] as const;

export const OutroVoice: React.FC = () => (
  <AbsoluteFill style={{ background: c.bg, fontFamily: font.sans, color: c.text }}>
    <Sequence durationInFrames={LOGO + 14} name="face">
      <Cam />
      <Audio src={staticFile("rush/outro-voice.wav")} trimBefore={FROM} trimAfter={TO} />
    </Sequence>
    <Sequence from={PANEL[0]} durationInFrames={PANEL[1] - PANEL[0]} name="bottleneck">
      <Panel length={PANEL[1] - PANEL[0]}>
        <Lines from={PANEL[0]} />
      </Panel>
    </Sequence>
    <Sequence from={LOGO} name="logo">
      <LogoIn />
    </Sequence>
    <Sequence from={VOICE} name="try">
      <Audio src={staticFile("rush/voice/try.wav")} />
    </Sequence>
  </AbsoluteFill>
);

/** The face, zoomed on every other piece so the cuts read as camera changes, blurred into the logo. */
const Cam: React.FC = () => {
  const frame = useCurrentFrame();
  const piece = cut.cuts.filter((t) => f(t) <= frame + FROM).length;
  const scale = piece % 2 ? 1.08 : 1;
  const out = interpolate(frame, [LOGO, LOGO + 12], [0, 1], { ...clamp, easing: ease.inOut });
  return (
    <AbsoluteFill style={{ filter: `blur(${out * 18}px) brightness(${1 - out * 0.75})` }}>
      <AbsoluteFill style={{ transformOrigin: "1330px 340px", transform: `scale(${scale})` }}>
        <Video src={staticFile("rush/outro-cam.mp4")} muted trimBefore={FROM} />
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

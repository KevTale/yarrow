import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Intro, INTRO_FRAMES } from "./Intro";
import { Middle, MIDDLE_FRAMES } from "./Middle";
import { Outro, OUTRO_FRAMES } from "./Outro";

/** The hackathon film from the three rushes: face cam, screen share, face cam. */
const BLEND = 10;
export const FILM_FRAMES = INTRO_FRAMES + MIDDLE_FRAMES + OUTRO_FRAMES - 2 * BLEND;

export const Film: React.FC = () => (
  <TransitionSeries>
    <TransitionSeries.Sequence durationInFrames={INTRO_FRAMES} name="intro">
      <Intro />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: BLEND })} />
    <TransitionSeries.Sequence durationInFrames={MIDDLE_FRAMES} name="middle">
      <Middle />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: BLEND })} />
    <TransitionSeries.Sequence durationInFrames={OUTRO_FRAMES} name="outro">
      <Outro />
    </TransitionSeries.Sequence>
  </TransitionSeries>
);

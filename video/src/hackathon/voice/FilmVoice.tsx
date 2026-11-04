import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Intro, INTRO_FRAMES } from "../Intro";
import { MIDDLE_VOICE_FRAMES, MiddleVoice } from "./MiddleVoice";
import { OUTRO_VOICE_FRAMES, OutroVoice } from "./OutroVoice";

/** The hackathon film with a middle made from the screen alone, under Kevin's cloned voice. */
const BLEND = 10;
export const FILM_VOICE_FRAMES = INTRO_FRAMES + MIDDLE_VOICE_FRAMES + OUTRO_VOICE_FRAMES - 2 * BLEND;

export const FilmVoice: React.FC = () => (
  <TransitionSeries>
    <TransitionSeries.Sequence durationInFrames={INTRO_FRAMES} name="intro">
      <Intro />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: BLEND })} />
    <TransitionSeries.Sequence durationInFrames={MIDDLE_VOICE_FRAMES} name="middle">
      <MiddleVoice />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: BLEND })} />
    <TransitionSeries.Sequence durationInFrames={OUTRO_VOICE_FRAMES} name="outro">
      <OutroVoice />
    </TransitionSeries.Sequence>
  </TransitionSeries>
);

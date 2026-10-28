import { Audio } from "@remotion/media";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Sequence, staticFile, useVideoConfig } from "remotion";
import { End } from "./scenes/End";
import { Intro } from "./scenes/Intro";
import { PullRequest } from "./scenes/PullRequest";
import { Sponsors } from "./scenes/Sponsors";
import { Work } from "./scenes/Work";

/** Each cut: a short crossfade. */
export const CUT = 12;
export const SCENES = {
  intro: 240,
  work: 270,
  pullRequest: 200,
  sponsors: 150,
  end: 120,
};
export const LAUNCH_FRAMES =
  Object.values(SCENES).reduce((sum, d) => sum + d, 0) - CUT * 4;

/** Where each scene starts on the whole timeline. */
const at = {
  work: SCENES.intro - CUT,
  pullRequest: SCENES.intro + SCENES.work - 2 * CUT,
  sponsors: SCENES.intro + SCENES.work + SCENES.pullRequest - 3 * CUT,
  end:
    SCENES.intro + SCENES.work + SCENES.pullRequest + SCENES.sponsors - 4 * CUT,
};

const Sfx: React.FC<{ from: number; src: string; volume: number }> = ({
  from,
  src,
  volume,
}) => {
  const { fps } = useVideoConfig();
  return (
    <Sequence from={from} premountFor={fps}>
      <Audio src={src} volume={volume} />
    </Sequence>
  );
};

/** The 30-second launch film: paste, work, pull request, sponsors, address. */
export const Launch: React.FC = () => {
  const { fps } = useVideoConfig();
  const timing = linearTiming({ durationInFrames: CUT });
  return (
    <>
      <TransitionSeries>
        <TransitionSeries.Sequence
          name="Intro"
          durationInFrames={SCENES.intro}
          premountFor={fps}
        >
          <Intro />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={timing} />
        <TransitionSeries.Sequence
          name="Work"
          durationInFrames={SCENES.work}
          premountFor={fps}
        >
          <Work />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={timing} />
        <TransitionSeries.Sequence
          name="Pull request"
          durationInFrames={SCENES.pullRequest}
          premountFor={fps}
        >
          <PullRequest />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={timing} />
        <TransitionSeries.Sequence
          name="Sponsors"
          durationInFrames={SCENES.sponsors}
          premountFor={fps}
        >
          <Sponsors />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={timing} />
        <TransitionSeries.Sequence
          name="End"
          durationInFrames={SCENES.end}
          premountFor={fps}
        >
          <End />
        </TransitionSeries.Sequence>
      </TransitionSeries>

      <Audio src={staticFile("music.wav")} volume={1} />
      <Sfx
        from={140}
        src="https://remotion.media/mouse-click.wav"
        volume={0.8}
      />
      <Sfx
        from={201}
        src="https://remotion.media/mouse-click.wav"
        volume={0.8}
      />
      <Sfx
        from={at.work - 4}
        src="https://remotion.media/whoosh.wav"
        volume={0.35}
      />
      <Sfx
        from={at.work + 222}
        src="https://remotion.media/ding.wav"
        volume={0.4}
      />
      <Sfx
        from={at.pullRequest + 14}
        src="https://remotion.media/switch.wav"
        volume={0.6}
      />
      <Sfx
        from={at.sponsors + 48}
        src="https://remotion.media/ding.wav"
        volume={0.4}
      />
      <Sfx
        from={at.end - 4}
        src="https://remotion.media/whoosh.wav"
        volume={0.3}
      />
    </>
  );
};

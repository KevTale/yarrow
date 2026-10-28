import { Audio } from "@remotion/media";
import { interpolate, Sequence, staticFile, useVideoConfig } from "remotion";
import { Dashboard } from "./scenes/Dashboard";
import { End } from "./scenes/End";
import { Intro } from "./scenes/Intro";
import { PullRequest } from "./scenes/PullRequest";
import { Sponsors } from "./scenes/Sponsors";
import { Work } from "./scenes/Work";
import { BEAT, FPS, MUSIC_OFFSET, SCENE, take, VOICE_AT } from "./timeline";

type LineId = keyof typeof take;
const lines = Object.keys(VOICE_AT) as LineId[];

/** A line's span in the take, in frames: a breath before, its tail after. */
const span = (id: LineId) => ({
  from: Math.max(0, Math.floor(take[id].start * FPS) - 2),
  to: Math.ceil(take[id].end * FPS) + 6,
});

/** Frames where the voice speaks, for the music to step back. */
const speaking = lines.map((id) => {
  const { from, to } = span(id);
  return { from: VOICE_AT[id], to: VOICE_AT[id] + (to - from) };
});

/** The music: full between lines, lower under the voice, with short ramps. */
const musicVolume = (frame: number) => {
  const under = Math.max(
    ...speaking.map(({ from, to }) =>
      interpolate(frame, [from - 6, from, to, to + 8], [0, 1, 1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      }),
    ),
  );
  return interpolate(under, [0, 1], [0.75, 0.3]);
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

/**
 * The launch film: paste, work, dashboard, pull request, sponsors, address.
 * Hard cuts on the music's changes; each scene brings itself in.
 */
export const Launch: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <>
      <Sequence
        name="Intro"
        from={SCENE.intro.from}
        durationInFrames={SCENE.intro.duration}
        premountFor={fps}
      >
        <Intro />
      </Sequence>
      <Sequence
        name="Work"
        from={SCENE.work.from}
        durationInFrames={SCENE.work.duration}
        premountFor={fps}
      >
        <Work />
      </Sequence>
      <Sequence
        name="Dashboard"
        from={SCENE.dashboard.from}
        durationInFrames={SCENE.dashboard.duration}
        premountFor={fps}
      >
        <Dashboard />
      </Sequence>
      <Sequence
        name="Pull request"
        from={SCENE.github.from}
        durationInFrames={SCENE.github.duration}
        premountFor={fps}
      >
        <PullRequest />
      </Sequence>
      <Sequence
        name="Sponsors"
        from={SCENE.sponsors.from}
        durationInFrames={SCENE.sponsors.duration}
        premountFor={fps}
      >
        <Sponsors />
      </Sequence>
      <Sequence
        name="End"
        from={SCENE.end.from}
        durationInFrames={SCENE.end.duration}
        premountFor={fps}
      >
        <End />
      </Sequence>

      <Audio
        src={staticFile("music.mp3")}
        trimBefore={MUSIC_OFFSET}
        volume={musicVolume}
      />
      {lines.map((id) => (
        <Sequence
          key={id}
          name={`Voice: ${id}`}
          from={VOICE_AT[id]}
          premountFor={fps}
        >
          <Audio
            src={staticFile("voice/take.mp3")}
            trimBefore={span(id).from}
            trimAfter={span(id).to}
          />
        </Sequence>
      ))}

      <Sfx
        from={BEAT.pasteClick}
        src="https://remotion.media/mouse-click.wav"
        volume={0.7}
      />
      <Sfx
        from={BEAT.goClick}
        src="https://remotion.media/mouse-click.wav"
        volume={0.7}
      />
      <Sfx
        from={BEAT.approved}
        src="https://remotion.media/ding.wav"
        volume={0.3}
      />
      <Sfx
        from={BEAT.chevronClick}
        src="https://remotion.media/mouse-click.wav"
        volume={0.6}
      />
      <Sfx
        from={BEAT.githubClick}
        src="https://remotion.media/mouse-click.wav"
        volume={0.6}
      />
    </>
  );
};

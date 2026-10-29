import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { FPS, take, VOICE_AT } from "../timeline";

type LineId = keyof typeof take;

/** A line's words as [word, start in the take (s)]: JSON loses the tuple. */
const wordsOf = (line: LineId) =>
  take[line].words as unknown as [string, number][];

/**
 * The film's frame a spoken word starts on: the line's place in the film
 * plus the word's place in the line (src/voice-take.json).
 */
export const wordAt = (line: LineId, index: number) =>
  VOICE_AT[line] +
  Math.round((wordsOf(line)[index]![1] - take[line].start) * FPS);

/**
 * Words written as the voice says them, each rising on its own syllable:
 * what is big on screen is what is heard. `words` picks a range of the
 * line's words; `sceneFrom` turns the film's frames into the scene's.
 */
export const Spoken: React.FC<{
  line: LineId;
  sceneFrom: number;
  words?: [number, number];
  /** Drop the last word's closing period, for a title. */
  trim?: boolean;
  style?: React.CSSProperties;
  wordStyle?: (word: string, index: number) => React.CSSProperties | undefined;
}> = ({ line, sceneFrom, words, trim, style, wordStyle }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [from, to] = words ?? [0, wordsOf(line).length];
  return (
    <span style={style}>
      {wordsOf(line)
        .slice(from, to)
        .map(([word], k) => {
          const i = from + k;
          const t = spring({
            frame: frame - (wordAt(line, i) - sceneFrom) + 2,
            fps,
            config: { damping: 200 },
            durationInFrames: 14,
          });
          const shown = trim && i === to - 1 ? word.replace(/\.$/, "") : word;
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                opacity: t,
                translate: `0 ${interpolate(t, [0, 1], [0.35, 0])}em`,
                filter: `blur(${interpolate(t, [0, 1], [6, 0])}px)`,
                marginRight: i < to - 1 ? "0.26em" : 0,
                ...wordStyle?.(word, i),
              }}
            >
              {shown}
            </span>
          );
        })}
    </span>
  );
};

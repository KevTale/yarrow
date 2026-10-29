import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Mark } from "../components/Mark";
import { Spoken, wordAt } from "../components/Spoken";
import { c, clamp, font } from "../theme";
import { SCENE } from "../timeline";

/**
 * The mark blooms again over the address; the address comes on "Yarrow",
 * the promise word by word as it is said.
 */
export const End: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const url = spring({
    frame: frame - (wordAt("end", 0) - SCENE.end.from) + 2,
    fps,
    config: { damping: 200 },
    durationInFrames: 24,
  });
  const lastWord = wordAt("end", 6) - SCENE.end.from;
  const free = interpolate(
    frame,
    [lastWord + 14, lastWord + 28],
    [0, 1],
    clamp,
  );

  return (
    <AbsoluteFill
      style={{
        background: c.bg,
        fontFamily: font.sans,
        color: c.text,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ display: "grid", justifyItems: "center", gap: 0 }}>
        <Mark size={170} />
        <div
          style={{
            marginTop: 40,
            fontFamily: font.display,
            fontWeight: 500,
            fontSize: 132,
            letterSpacing: "-0.02em",
            opacity: url,
            translate: `0 ${interpolate(url, [0, 1], [30, 0])}px`,
          }}
        >
          yarrow<span style={{ color: c.amber }}>.run</span>
        </div>
        <div
          style={{
            marginTop: 18,
            fontFamily: font.display,
            fontWeight: 500,
            fontSize: 56,
            color: c.secondary,
          }}
        >
          <Spoken line="end" sceneFrom={SCENE.end.from} words={[1, 7]} trim />
        </div>
        <div
          style={{ marginTop: 44, fontSize: 26, color: c.muted, opacity: free }}
        >
          No API key · No card · No subscription
        </div>
      </div>
    </AbsoluteFill>
  );
};

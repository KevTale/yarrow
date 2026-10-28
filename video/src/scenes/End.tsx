import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Mark } from "../components/Mark";
import { c, clamp, font } from "../theme";

/** The mark blooms again over the address, the promise under it. */
export const End: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const url = spring({
    frame: frame - 14,
    fps,
    config: { damping: 200 },
    durationInFrames: 24,
  });
  const line = interpolate(frame, [30, 46], [0, 1], clamp);
  const free = interpolate(frame, [42, 58], [0, 1], clamp);

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(900px 520px at 50% 46%, #f2b5440f, transparent 70%), ${c.bg}`,
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
            fontSize: 40,
            color: c.secondary,
            opacity: line,
          }}
        >
          Free pull requests from frontier AI
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

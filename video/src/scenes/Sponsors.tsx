import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Tile } from "../components/kit";
import { board, prCostCents, sponsor, topUpCents } from "../story";
import { c, clamp, ease, font } from "../theme";

const ROW = 112;
/** The payment lands, then the row climbs on the music's lift (local frames). */
const PAY = 82;
const CLIMB = 90;

const dollars = (cents: number) =>
  `$${Math.round(cents / 100).toLocaleString("en-US")}`;

/**
 * Why it is free: sponsors fund the compute. Today's board, then a new
 * payment lifts a sponsor to the top. Each row: rank, logo, name, what it
 * funded, what it paid.
 */
export const Sponsors: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const paid = interpolate(frame, [PAY, PAY + 14], [0, 1], {
    ...clamp,
    easing: ease.standard,
  });
  const climb = spring({
    frame: frame - CLIMB,
    fps,
    config: { damping: 16, stiffness: 120 },
  });
  const titleIn = spring({
    frame,
    fps,
    config: { damping: 200 },
    durationInFrames: 18,
  });

  // Before the climb: Mossgrove, Orbitkit, Quillfern, anonymous. After: Quillfern first.
  const slot = (index: number) => {
    const after =
      board[index]!.name === sponsor.name ? 0 : index < 2 ? index + 1 : index;
    return interpolate(climb, [0, 1], [index, after]);
  };

  return (
    <AbsoluteFill
      style={{ background: c.bg, fontFamily: font.sans, color: c.text }}
    >
      <div
        style={{
          position: "absolute",
          top: 110,
          width: "100%",
          textAlign: "center",
          opacity: titleIn,
          translate: `0 ${(1 - titleIn) * 20}px`,
        }}
      >
        <div
          style={{
            fontFamily: font.display,
            fontWeight: 500,
            fontSize: 92,
            letterSpacing: "-0.02em",
          }}
        >
          Why is it free?
        </div>
        <div style={{ marginTop: 18, fontSize: 38, color: c.gold }}>
          Sponsors fund the compute.
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 460,
          top: 400,
          width: 1000,
          height: ROW * board.length,
        }}
      >
        {board.map((row, i) => {
          const isSponsor = row.name === sponsor.name;
          const cents = row.cents + (isSponsor ? topUpCents * paid : 0);
          const prs = Math.floor(cents / prCostCents);
          const rowIn = spring({
            frame: frame - 8 - i * 4,
            fps,
            config: { damping: 200 },
            durationInFrames: 18,
          });
          const rank = Math.round(slot(i)) + 1;
          const lit = isSponsor
            ? interpolate(
                frame,
                [PAY, PAY + 6, CLIMB + 40, CLIMB + 70],
                [0, 1, 1, 0.4],
                clamp,
              )
            : 0;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: slot(i) * ROW,
                height: ROW,
                display: "grid",
                gridTemplateColumns: "56px 64px 1fr auto auto",
                gap: 26,
                alignItems: "center",
                padding: "0 16px",
                boxSizing: "border-box",
                borderBottom: `1px solid ${c.lineSoft}`,
                background: `linear-gradient(90deg, rgba(242, 181, 68, ${0.13 * lit}), rgba(242, 181, 68, 0))`,
                opacity: rowIn,
                translate: `0 ${(1 - rowIn) * 14}px`,
                zIndex: isSponsor ? 2 : 1,
              }}
            >
              <span
                style={{
                  fontFamily: font.display,
                  fontWeight: 500,
                  fontSize: 34,
                  textAlign: "center",
                  color: lit > 0.5 ? c.amber : "#6d737e",
                }}
              >
                {rank}
              </span>
              {row.name ? (
                <Tile
                  letter={row.letter}
                  bg={row.color}
                  size={64}
                  radius={16}
                />
              ) : (
                <Tile
                  letter="?"
                  bg={c.elevated}
                  fg={c.muted}
                  size={64}
                  radius={16}
                />
              )}
              <span
                style={{
                  fontSize: 34,
                  fontWeight: 600,
                  fontStyle: row.name ? "normal" : "italic",
                  color: row.name ? c.text : c.secondary,
                }}
              >
                {row.name ?? "Anonymous sponsor"}
              </span>
              <span
                style={{ fontFamily: font.mono, fontSize: 24, color: c.muted }}
              >
                {prs} PRs
              </span>
              <span
                style={{
                  position: "relative",
                  minWidth: 110,
                  textAlign: "right",
                  fontFamily: font.display,
                  fontWeight: 500,
                  fontSize: 40,
                  color: lit > 0.5 ? c.amber : c.text,
                }}
              >
                {dollars(cents)}
                {isSponsor && (
                  <span
                    style={{
                      position: "absolute",
                      right: 0,
                      bottom: "100%",
                      fontSize: 28,
                      whiteSpace: "nowrap",
                      color: c.amber,
                      opacity: interpolate(
                        frame,
                        [PAY - 4, PAY + 2, PAY + 34, PAY + 46],
                        [0, 1, 1, 0],
                        clamp,
                      ),
                      translate: `0 ${interpolate(frame, [PAY - 4, PAY + 10], [14, 0], { ...clamp, easing: ease.enter })}px`,
                    }}
                  >
                    +{dollars(topUpCents)}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

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

const ROW = 128;
const PAY = 48;
const CLIMB = 66;

const dollars = (cents: number) =>
  `$${Math.round(cents / 100).toLocaleString("en-US")}`;

/**
 * Why it is free: sponsors pay for the compute. Today's board, then a new
 * payment lifts a sponsor to the top.
 */
export const Sponsors: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const paid = interpolate(frame, [PAY, PAY + 16], [0, 1], {
    ...clamp,
    easing: ease.standard,
  });
  const climb = spring({
    frame: frame - CLIMB,
    fps,
    config: { damping: 16, stiffness: 120 },
  });
  const total =
    board.reduce((sum, row) => sum + row.cents, 0) + topUpCents * paid;
  const titleIn = spring({
    frame,
    fps,
    config: { damping: 200 },
    durationInFrames: 20,
  });

  // Before the climb: Mossgrove, Orbitkit, Quillfern, anonymous. After: Quillfern first.
  const slot = (index: number) => {
    const before = index;
    const after =
      board[index]!.name === sponsor.name ? 0 : index < 2 ? index + 1 : index;
    return interpolate(climb, [0, 1], [before, after]);
  };

  return (
    <AbsoluteFill
      style={{ background: c.bg, fontFamily: font.sans, color: c.text }}
    >
      <div
        style={{
          position: "absolute",
          top: 96,
          width: "100%",
          textAlign: "center",
          opacity: titleIn,
        }}
      >
        <div
          style={{
            fontFamily: font.display,
            fontWeight: 500,
            fontSize: 76,
            letterSpacing: "-0.02em",
          }}
        >
          Why is it free?
        </div>
        <div style={{ marginTop: 18, fontSize: 32, color: c.secondary }}>
          Sponsors pay for the compute.{" "}
          <span style={{ color: c.gold }}>
            Their card ships in every pull request.
          </span>
        </div>
      </div>

      <div style={{ position: "absolute", left: 400, top: 330, width: 1120 }}>
        <div
          style={{
            display: "flex",
            alignItems: "end",
            justifyContent: "space-between",
            paddingBottom: 20,
            borderBottom: `1px solid ${c.line}`,
            opacity: titleIn,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: font.display,
                fontWeight: 500,
                fontSize: 44,
              }}
            >
              Sponsors
            </div>
            <div style={{ fontSize: 23, color: c.secondary, marginTop: 6 }}>
              <span style={{ color: c.amber }}>
                $10 funds ≈ {Math.floor(1000 / prCostCents)} PRs.
              </span>{" "}
              Your company card ships in each one.
            </div>
          </div>
          <div
            style={{
              display: "flex",
              padding: 5,
              gap: 4,
              borderRadius: 30,
              border: `1px solid ${c.line}`,
              background: c.surface,
              fontSize: 22,
            }}
          >
            <span
              style={{
                padding: "9px 20px",
                borderRadius: 24,
                background: c.hover,
              }}
            >
              Today{" "}
              <b
                style={{
                  fontFamily: font.display,
                  fontWeight: 500,
                  marginLeft: 6,
                }}
              >
                {dollars(total)}
              </b>
            </span>
            <span style={{ padding: "9px 20px", color: c.secondary }}>
              All time{" "}
              <b
                style={{
                  fontFamily: font.display,
                  fontWeight: 500,
                  marginLeft: 6,
                }}
              >
                $1,340
              </b>
            </span>
          </div>
        </div>

        <div style={{ position: "relative", height: ROW * board.length }}>
          {board.map((row, i) => {
            const isSponsor = row.name === sponsor.name;
            const cents = row.cents + (isSponsor ? topUpCents * paid : 0);
            const prs = Math.floor(cents / prCostCents);
            const rowIn = spring({
              frame: frame - 6 - i * 4,
              fps,
              config: { damping: 200 },
              durationInFrames: 20,
            });
            const rank = Math.round(slot(i)) + 1;
            const lit = isSponsor
              ? interpolate(
                  frame,
                  [PAY, PAY + 8, CLIMB + 40, CLIMB + 70],
                  [0, 1, 1, 0.35],
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
                  gridTemplateColumns: "50px 64px 1fr",
                  gap: 22,
                  alignItems: "center",
                  padding: "0 12px",
                  boxSizing: "border-box",
                  borderBottom: `1px solid ${c.lineSoft}`,
                  background: `linear-gradient(90deg, rgba(242, 181, 68, ${0.12 * lit}), rgba(242, 181, 68, 0))`,
                  opacity: rowIn,
                  zIndex: isSponsor ? 2 : 1,
                }}
              >
                <span
                  style={{
                    fontFamily: font.display,
                    fontWeight: 500,
                    fontSize: 30,
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
                <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 28,
                        fontWeight: 600,
                        fontStyle: row.name ? "normal" : "italic",
                        color: row.name ? c.text : c.secondary,
                      }}
                    >
                      {row.name ?? "Anonymous sponsor"}
                    </span>
                    <span
                      style={{
                        position: "relative",
                        fontFamily: font.display,
                        fontWeight: 500,
                        fontSize: 32,
                        color: lit > 0.5 ? c.amber : c.text,
                      }}
                    >
                      {dollars(cents)}
                      {isSponsor && (
                        <span
                          style={{
                            position: "absolute",
                            right: "calc(100% + 20px)",
                            top: 2,
                            fontSize: 28,
                            whiteSpace: "nowrap",
                            color: c.amber,
                            opacity: interpolate(
                              frame,
                              [PAY - 6, PAY, PAY + 30, PAY + 44],
                              [0, 1, 1, 0],
                              clamp,
                            ),
                            translate: `${interpolate(frame, [PAY - 6, PAY + 6], [-24, 0], { ...clamp, easing: ease.enter })}px 0`,
                          }}
                        >
                          +{dollars(topUpCents)}
                        </span>
                      )}
                    </span>
                  </div>
                  {row.description && (
                    <span style={{ fontSize: 21, color: c.secondary }}>
                      {row.description}
                    </span>
                  )}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontFamily: font.mono,
                      fontSize: 18,
                      color: c.muted,
                    }}
                  >
                    <span>{row.site ?? ""}</span>
                    <span>
                      {prs} PRs · {Math.floor(prs * 0.75)} merged
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

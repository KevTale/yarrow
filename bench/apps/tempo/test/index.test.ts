import { describe, expect, it } from "vitest";
import { format, parse } from "../src/index.js";

describe("parse", () => {
  it("reads durations as people write them", () => {
    expect(parse("1h 30m")).toBe(5_400_000);
    expect(parse("2 days")).toBe(172_800_000);
    expect(parse("1.5 hours")).toBe(5_400_000);
    expect(parse("1 hour and 5 minutes")).toBe(3_900_000);
    expect(parse("90s")).toBe(90_000);
    expect(parse("250ms")).toBe(250);
  });

  it("refuses what is not a duration", () => {
    expect(() => parse("soon")).toThrow(/cannot read/);
    expect(() => parse("3 fortnights")).toThrow(/unknown unit/);
  });
});

describe("format", () => {
  it("says a duration in words", () => {
    expect(format(5_400_000)).toBe("1 hour 30 minutes");
    expect(format(90_061_000)).toBe("1 day 1 hour 1 minute 1 second");
    expect(format(1_000)).toBe("1 second");
  });

  it("says it short", () => {
    expect(format(5_400_000, { style: "short" })).toBe("1h 30m");
  });

  it("drops what is below the smallest unit", () => {
    expect(format(5_430_500, { smallest: "m" })).toBe("1 hour 30 minutes");
    expect(format(1_250, { smallest: "ms" })).toBe("1 second 250 milliseconds");
    expect(format(400)).toBe("0 seconds");
  });

  it("keeps the sign", () => {
    expect(format(-90_000, { style: "short" })).toBe("-1m 30s");
  });
});

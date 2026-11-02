/**
 * tempo: read and write durations the way people do. "1h 30m" is
 * 5,400,000 ms, and 5,400,000 ms is "1 hour 30 minutes".
 */

export type Unit = "d" | "h" | "m" | "s" | "ms";

const MS: Record<Unit, number> = {
  d: 86_400_000,
  h: 3_600_000,
  m: 60_000,
  s: 1_000,
  ms: 1,
};

const NAMES: Record<Unit, [string, string]> = {
  d: ["day", "days"],
  h: ["hour", "hours"],
  m: ["minute", "minutes"],
  s: ["second", "seconds"],
  ms: ["millisecond", "milliseconds"],
};

const ALIASES: Record<string, Unit> = {
  d: "d",
  day: "d",
  days: "d",
  h: "h",
  hr: "h",
  hrs: "h",
  hour: "h",
  hours: "h",
  m: "m",
  min: "m",
  mins: "m",
  minute: "m",
  minutes: "m",
  s: "s",
  sec: "s",
  secs: "s",
  second: "s",
  seconds: "s",
  ms: "ms",
  millisecond: "ms",
  milliseconds: "ms",
};

/**
 * Milliseconds in a duration as people write it: "1h 30m", "2 days",
 * "1.5 hours", "90s". Throws on anything else.
 */
export function parse(text: string): number {
  const parts = [
    ...text.toLowerCase().matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)/g),
  ];
  const rest = text.toLowerCase().replace(/(\d+(?:\.\d+)?)\s*([a-z]+)/g, "");
  if (parts.length === 0 || /[^\s,and]/.test(rest.replace(/\band\b/g, "")))
    throw new Error(`tempo: cannot read "${text}" as a duration`);
  return Math.round(
    parts.reduce((total, [, value, word]) => {
      const unit = ALIASES[word!];
      if (!unit) throw new Error(`tempo: unknown unit "${word}" in "${text}"`);
      return total + Number(value) * MS[unit];
    }, 0),
  );
}

export interface FormatOptions {
  /** "long": "1 hour 30 minutes" (the default); "short": "1h 30m". */
  style?: "long" | "short";
  /** The smallest unit shown; below it is dropped. "s" by default. */
  smallest?: Unit;
}

const ORDER: Unit[] = ["d", "h", "m", "s", "ms"];

/** A duration in milliseconds, as people say it. */
export function format(ms: number, options: FormatOptions = {}): string {
  const style = options.style ?? "long";
  const smallest = ORDER.indexOf(options.smallest ?? "s");
  if (!Number.isFinite(ms)) throw new Error("tempo: not a duration");
  let rest = Math.abs(ms);
  const parts: string[] = [];
  for (const unit of ORDER.slice(0, smallest + 1)) {
    const count = Math.floor(rest / MS[unit]);
    rest -= count * MS[unit];
    if (count === 0) continue;
    parts.push(
      style === "short"
        ? `${count}${unit}`
        : `${count} ${NAMES[unit][count === 1 ? 0 : 1]}`,
    );
  }
  if (parts.length === 0) {
    const unit = ORDER[smallest]!;
    return style === "short" ? `0${unit}` : `0 ${NAMES[unit][1]}`;
  }
  return `${ms < 0 ? "-" : ""}${parts.join(" ")}`;
}

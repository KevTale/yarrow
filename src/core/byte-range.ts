/**
 * One byte range, as players ask for it ("bytes=0-", "bytes=100-199",
 * "bytes=-500"). Read here rather than from R2's answer: deployed R2 reports
 * a range with every field present, unset ones included.
 */
export function byteRange(header: string | null): R2Range | null {
  const match = header?.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) return { suffix: Number(match[2]) };
  const offset = Number(match[1]);
  if (!match[2]) return { offset };
  const end = Number(match[2]);
  return end < offset ? null : { offset, length: end - offset + 1 };
}

/** The bytes a range covers in an object of this size. */
export function span(
  range: R2Range,
  size: number,
): { offset: number; length: number } {
  if ("suffix" in range) {
    const length = Math.min(range.suffix, size);
    return { offset: size - length, length };
  }
  const offset = range.offset ?? 0;
  return {
    offset,
    length: Math.min(range.length ?? size - offset, size - offset),
  };
}

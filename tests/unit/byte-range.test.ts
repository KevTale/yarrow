import { describe, expect, it } from "vitest";
import { byteRange, span } from "../../src/core/byte-range";

describe("byte ranges", () => {
  it("read what players ask for", () => {
    expect(byteRange("bytes=0-")).toEqual({ offset: 0 });
    expect(byteRange("bytes=100-199")).toEqual({ offset: 100, length: 100 });
    expect(byteRange("bytes=-500")).toEqual({ suffix: 500 });
    for (const header of [null, "", "bytes=-", "bytes=9-3", "bytes=0-1,5-9"])
      expect(byteRange(header)).toBeNull();
  });

  it("cover the object, never past its end", () => {
    expect(span({ offset: 0 }, 1000)).toEqual({ offset: 0, length: 1000 });
    expect(span({ offset: 900, length: 500 }, 1000)).toEqual({
      offset: 900,
      length: 100,
    });
    expect(span({ suffix: 5000 }, 1000)).toEqual({ offset: 0, length: 1000 });
  });
});

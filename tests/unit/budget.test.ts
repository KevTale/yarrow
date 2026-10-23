import { describe, expect, it } from "vitest";
import { available, reserve, settle } from "../../src/core/budget";

describe("compute budget", () => {
  const credit = { creditCents: 2000, reservedCents: 0, debitedCents: 0 };
  it("reserves before executing, debits actual cost and releases unused credit", () => {
    const reserved = reserve(credit, 800);
    expect(available(reserved)).toBe(1200);
    const settled = settle(reserved, 800, 342);
    expect(settled).toEqual({
      creditCents: 2000,
      reservedCents: 0,
      debitedCents: 342,
    });
    expect(available(settled)).toBe(1658);
    expect(credit.reservedCents).toBe(0);
  });
  it("rejects overspend, unreserved settlement and fractional cents", () => {
    expect(() => reserve(credit, 2001)).toThrow();
    expect(() => reserve(credit, 5.5)).toThrow();
    expect(() => reserve(credit, -50)).toThrow();
    expect(() => settle(credit, 100, 10)).toThrow();
    expect(() => settle(reserve(credit, 100), 100, 101)).toThrow();
  });
  it("does not release another run's reservation", () => {
    const reserved = reserve(reserve(credit, 800), 500);
    expect(settle(reserved, 800, 342)).toEqual({
      creditCents: 2000,
      reservedCents: 500,
      debitedCents: 342,
    });
  });
});

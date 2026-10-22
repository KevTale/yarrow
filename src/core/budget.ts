export interface Balance {
  creditCents: number;
  reservedCents: number;
  debitedCents: number;
}

function cents(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid cents amount");
}

export function available(balance: Balance): number {
  [balance.creditCents, balance.reservedCents, balance.debitedCents].forEach(
    cents,
  );
  const remaining =
    balance.creditCents - balance.reservedCents - balance.debitedCents;
  if (remaining < 0) throw new Error("Overdrawn balance");
  return remaining;
}

export function reserve(balance: Balance, amountCents: number): Balance {
  cents(amountCents);
  if (amountCents === 0 || amountCents > available(balance))
    throw new Error("Insufficient available credit");
  return { ...balance, reservedCents: balance.reservedCents + amountCents };
}

export function settle(
  balance: Balance,
  reservedCents: number,
  actualCostCents: number,
): Balance {
  available(balance);
  cents(reservedCents);
  cents(actualCostCents);
  if (reservedCents === 0 || reservedCents > balance.reservedCents)
    throw new Error("Reservation not found");
  if (actualCostCents > reservedCents)
    throw new Error("Cost exceeds reservation");
  return {
    ...balance,
    reservedCents: balance.reservedCents - reservedCents,
    debitedCents: balance.debitedCents + actualCostCents,
  };
}

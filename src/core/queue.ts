/**
 * Which queued items start now. Runs are parallel; this only decides the
 * order when money or concurrency is scarce: FIFO within each account,
 * round-robin between accounts, least recently served account first.
 */
export interface DispatchCandidate {
  kind: "implementation" | "correction";
  /** Work unit ID for implementations, correction request ID for corrections. */
  id: string;
  workUnitId: string;
  accountId: string;
  queuedAt: Date;
}

export interface DispatchState {
  /** Sponsor-funded runs currently running, per account. */
  runningByAccount: ReadonlyMap<string, number>;
  /** When each account last had a run start. Missing means never. */
  lastServedAt: ReadonlyMap<string, Date>;
  /** Work units with a run in progress: a correction must wait for it. */
  busyWorkUnits: ReadonlySet<string>;
  perAccountLimit: number;
  /** How many runs this dispatch cycle may start in total. */
  globalLimit: number;
}

export const PER_ACCOUNT_CONCURRENCY = 5; // hypothesis

export function planDispatch(
  candidates: readonly DispatchCandidate[],
  state: DispatchState,
): DispatchCandidate[] {
  const byAccount = new Map<string, DispatchCandidate[]>();
  for (const candidate of [...candidates].sort(
    (a, b) =>
      a.queuedAt.getTime() - b.queuedAt.getTime() || a.id.localeCompare(b.id),
  )) {
    const queue = byAccount.get(candidate.accountId) ?? [];
    queue.push(candidate);
    byAccount.set(candidate.accountId, queue);
  }
  const accounts = [...byAccount.keys()].sort((a, b) => {
    const servedA = state.lastServedAt.get(a)?.getTime() ?? -Infinity;
    const servedB = state.lastServedAt.get(b)?.getTime() ?? -Infinity;
    if (servedA !== servedB) return servedA - servedB;
    const oldestA = byAccount.get(a)![0]!.queuedAt.getTime();
    const oldestB = byAccount.get(b)![0]!.queuedAt.getTime();
    return oldestA - oldestB || a.localeCompare(b);
  });
  const slots = new Map(
    accounts.map((account) => [
      account,
      Math.max(
        0,
        state.perAccountLimit - (state.runningByAccount.get(account) ?? 0),
      ),
    ]),
  );
  const busy = new Set(state.busyWorkUnits);
  const plan: DispatchCandidate[] = [];
  let progressed = true;
  while (plan.length < state.globalLimit && progressed) {
    progressed = false;
    for (const account of accounts) {
      if (plan.length >= state.globalLimit) break;
      if ((slots.get(account) ?? 0) === 0) continue;
      const queue = byAccount.get(account)!;
      const index = queue.findIndex((item) => !busy.has(item.workUnitId));
      if (index === -1) continue;
      const [next] = queue.splice(index, 1);
      plan.push(next!);
      busy.add(next!.workUnitId);
      slots.set(account, slots.get(account)! - 1);
      progressed = true;
    }
  }
  return plan;
}

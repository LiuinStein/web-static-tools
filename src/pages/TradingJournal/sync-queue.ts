import { Trade, TradeChange, sameTrade } from './model';

// Serialize cloud work without preventing local edits while a request is in flight.
export class SyncQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  constructor(private onBusyChange: (busy: boolean) => void = () => {}) {}
  get busy(): boolean {
    return this.pending > 0;
  }
  run<T>(action: () => Promise<T>): Promise<T> {
    this.pending += 1;
    if (this.pending === 1) this.onBusyChange(true);
    const task = this.tail.then(action);
    const finish = () => {
      this.pending -= 1;
      if (!this.pending) this.onBusyChange(false);
    };
    this.tail = task.then(finish, finish);
    return task;
  }
}

interface SyncSnapshot {
  remote: Trade[];
  pending: Trade[];
  changes?: TradeChange[];
}
// Keep work saved during an upload; advance its baseline only for our own completed edit.
export function completeSync(latest: SyncSnapshot, sent: SyncSnapshot, remote: Trade[]): SyncSnapshot {
  const uploadedOperations = new Set((sent.changes || []).map((change) => change.operationId));
  const changes = (latest.changes || [])
    .filter((change) => !uploadedOperations.has(change.operationId))
    .map((change) => {
      const uploaded = (sent.changes || []).find((item) => item.id === change.id);
      const baseline = remote.find((trade) => trade.id === change.id);
      return uploaded && uploaded.after && baseline && sameTrade(change.before, uploaded.before) && sameTrade(baseline, uploaded.after)
        ? { ...change, before: baseline }
        : change;
    });
  return {
    remote,
    pending: latest.pending.filter((trade) => !sent.pending.some((uploaded) => sameTrade(trade, uploaded))),
    changes,
  };
}

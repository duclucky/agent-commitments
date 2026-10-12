import type { DurableOperation, OutboxRuntime } from "@agent-commitments/runtime";

export class ReconciliationWorker {
  constructor(private readonly runtime: OutboxRuntime, private readonly workerId: string) {}

  async tick(now = Date.now()): Promise<DurableOperation | undefined> {
    return (await this.runtime.processNext(this.workerId, now))
      ?? this.runtime.reconcileNext(this.workerId, now);
  }
}

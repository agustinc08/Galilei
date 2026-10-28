import type {
  OpenSearchDocumentRepository,
  SearchOutboxEvent,
} from './opensearch-document.repository';
import type { OpenSearchIndexService } from './opensearch-index.service';

const RETRY_LIMIT = 12;
const DEFAULT_INDEX_CONCURRENCY = 4;

export class OpenSearchSyncWorker {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly repository: OpenSearchDocumentRepository,
    private readonly index: OpenSearchIndexService,
    private readonly intervalMs = 1000,
    private readonly batchSize = 100,
    private readonly indexConcurrency = DEFAULT_INDEX_CONCURRENCY,
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.timer.unref?.();
    void this.tick();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.inFlight;
  }

  async tick() {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.processBatch().finally(() => {
      this.inFlight = null;
    });
    await this.inFlight;
  }

  async retryFailed() {
    const response = await this.repository.withAdvisoryLock(false, async () => {
      return this.repository.retryFailedOutbox();
    });
    return response.acquired ? (response.value ?? 0) : 0;
  }

  private async processBatch() {
    try {
      if (!(await this.index.hasActiveIndex())) return;
      await this.repository.withAdvisoryLock(false, async () => {
        const events = await this.repository.claimOutboxByDocumentKey(
          this.batchSize,
        );
        const grouped = new Map<string, SearchOutboxEvent[]>();
        for (const event of events) {
          const group = grouped.get(event.documentKey) ?? [];
          group.push(event);
          grouped.set(event.documentKey, group);
        }
        const groups = [...grouped.values()];
        let nextGroup = 0;
        const workerCount = Math.min(
          Math.max(1, Math.trunc(this.indexConcurrency)),
          groups.length,
        );
        await Promise.all(
          Array.from({ length: workerCount }, async () => {
            for (;;) {
              const group = groups[nextGroup++];
              if (!group) return;
              await this.process(group);
            }
          }),
        );
      });
    } catch {
      // Only health/outbox counters are exposed; transport payloads and document text never enter logs.
    }
  }

  private async process(events: SearchOutboxEvent[]) {
    const representative = events[0];
    if (!representative) return;
    try {
      // Outbox rows carry invalidation keys, not historical document payloads.
      // One canonical projection per key covers every claimed notification.
      await this.index.indexKey(representative.documentKey);
      await this.repository.markOutboxProcessedMany(
        events.map((event) => event.id),
      );
    } catch {
      await Promise.all(
        events.map((event) =>
          this.repository
            .markOutboxFailed({
              ...event,
              attempts: Math.min(event.attempts, RETRY_LIMIT),
            })
            .catch(() => undefined),
        ),
      );
    }
  }
}

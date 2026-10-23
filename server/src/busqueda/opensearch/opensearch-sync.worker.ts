import type {
  OpenSearchDocumentRepository,
  SearchOutboxEvent,
} from './opensearch-document.repository';
import type { OpenSearchIndexService } from './opensearch-index.service';

const RETRY_LIMIT = 12;

export class OpenSearchSyncWorker {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly repository: OpenSearchDocumentRepository,
    private readonly index: OpenSearchIndexService,
    private readonly intervalMs = 1000,
    private readonly batchSize = 25,
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
        const events = await this.repository.claimOutbox(this.batchSize);
        for (const event of events) await this.process(event);
      });
    } catch {
      // Only health/outbox counters are exposed; transport payloads and document text never enter logs.
    }
  }

  private async process(event: SearchOutboxEvent) {
    try {
      await this.index.indexKey(event.documentKey);
      await this.repository.markOutboxProcessed(event.id);
    } catch {
      await this.repository
        .markOutboxFailed({
          ...event,
          attempts: Math.min(event.attempts, RETRY_LIMIT),
        })
        .catch(() => undefined);
    }
  }
}

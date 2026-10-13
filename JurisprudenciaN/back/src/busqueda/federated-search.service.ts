import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PostgresJurisprudenciaSearchAdapter } from './adapters/postgres-jurisprudencia-search.adapter';
import type { SearchContext, SearchResult, SearchSourceAdapter } from './adapters/search-source.adapter';
import type { SearchQueryAst } from './utils/search-ast';
import { getPrismaPoolDiagnostics } from '../prisma/create-prisma-client';

export type FederatedSourceStatus = { source: string; ok: boolean; total: number; latencyMs: number; error?: string };
export type FederatedSearchPage = {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  partial: boolean;
  results: SearchResult[];
  deduplicated: number;
  truncated: boolean;
  totalExact: boolean;
  sources: FederatedSourceStatus[];
  durationMs: number;
  parserMs?: number;
  adapterProfiles?: Record<string, { countMs: number; resultPageMs: number; serializationMs?: number; candidateStrategy?: string; candidateCount?: number; candidateGenerationCount?: number; windowExpansions?: number; windowSizes?: number[]; exactHitsByWindow?: number[]; stageTimings?: Record<string, number | number[]>; resultRows: number; failedQuery?: 'COUNT' | 'PAGE'; errorCode?: string; errorMessage?: string; queryCount?: number; queryFingerprints?: string[] } | null>;
  poolDiagnostics?: Record<string, { total: number; active: number; idle: number; waiting: number; max: number } | null>;
};

@Injectable()
export class FederatedSearchService implements OnModuleDestroy {
  constructor(
    private readonly jurisprudencia: SearchSourceAdapter | null,
    private readonly corpus: SearchSourceAdapter | null,
    private readonly timeoutMs = 5000,
  ) {}

  async search(query: SearchQueryAst, context: SearchContext): Promise<FederatedSearchPage> {
    const started = Date.now();
    const page = Math.max(1, Math.trunc(context.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(context.pageSize ?? 25)));
    const offset = (page - 1) * pageSize;
    const fetchLimit = Math.min(500, offset + pageSize);
    const sources: Array<{ name: 'JURISPRUDENCIA' | 'CORPUS'; adapter: SearchSourceAdapter | null }> = [
      { name: 'JURISPRUDENCIA', adapter: this.jurisprudencia },
      { name: 'CORPUS', adapter: this.corpus },
    ];
    const active = sources.filter((source) => source.adapter && (!context.sourceSystems || context.sourceSystems.includes(source.name)));
    const settled = await Promise.all(active.map(async ({ name, adapter }) => {
      const sourceStart = Date.now();
      try {
        const result = await withTimeout(adapter!.search(query, { ...context, page: 1, pageSize: fetchLimit, sourceSystems: [name] }), this.timeoutMs);
        return { name, adapter, result, status: { source: name, ok: true, total: result.total, latencyMs: Date.now() - sourceStart } as FederatedSourceStatus };
      } catch {
        return { name, adapter, result: null, status: { source: name, ok: false, total: 0, latencyMs: Date.now() - sourceStart, error: 'source_timeout_or_unavailable' } as FederatedSourceStatus };
      }
    }));
    const pages = settled.flatMap((item) => item.result ? [item.result] : []);
    const jurisprudenciaResults = settled.find((item) => item.name === 'JURISPRUDENCIA')?.result?.results ?? [];
    const knownJurisprudenciaIds = new Set<string>();
    for (const result of jurisprudenciaResults) {
      knownJurisprudenciaIds.add(result.id);
      knownJurisprudenciaIds.add(result.sourceId);
      const sentenciaId = result.metadata.sentenciaId;
      if (sentenciaId !== null && sentenciaId !== undefined) knownJurisprudenciaIds.add(String(sentenciaId));
    }
    let deduplicated = 0;
    const merged = pages.flatMap((sourcePage) => sourcePage.results).filter((result) => {
      if (result.sourceSystem !== 'CORPUS') return true;
      const duplicate = result.linkedResultIds?.some((id) => knownJurisprudenciaIds.has(id));
      if (duplicate) deduplicated += 1;
      return !duplicate;
    });
    merged.sort(stableCompare);
    const sourceTotal = pages.reduce((sum, item) => sum + item.total, 0);
    const total = Math.max(0, sourceTotal - deduplicated);
    const partial = settled.some((item) => item.result === null);
    const adapterProfiles = process.env.BJC_SEARCH_PROFILE === 'true' && process.env.NODE_ENV !== 'production'
      ? Object.fromEntries(settled.map((item) => [item.name, item.adapter?.getLastSearchProfile?.() ?? null]))
      : undefined;
    const poolDiagnostics = process.env.BJC_SEARCH_PROFILE === 'true' && process.env.NODE_ENV !== 'production'
      ? this.getPoolDiagnostics()
      : undefined;
    return {
      page, pageSize, total,
      results: merged.slice(offset, offset + pageSize),
      deduplicated,
      truncated: offset + pageSize > fetchLimit,
      partial,
      totalExact: !partial && deduplicated === 0 && pages.every((item) =>
        item.totalExact !== false && item.total <= fetchLimit,
      ),
      hasMore: pages.some((item) => item.hasMore === true) ||
        (offset + pageSize < total && pages.every((item) => item.totalExact !== false)),
      sources: settled.map((item) => item.status),
      durationMs: Date.now() - started,
      ...(adapterProfiles ? { adapterProfiles } : {}),
      ...(poolDiagnostics ? { poolDiagnostics } : {}),
    };
  }

  getPoolDiagnostics() {
    return {
      PRISMA: getPrismaPoolDiagnostics(),
      JURISPRUDENCIA: this.jurisprudencia?.getPoolDiagnostics?.() ?? null,
      CORPUS: this.corpus?.getPoolDiagnostics?.() ?? null,
    };
  }

  async onModuleDestroy() {
    await Promise.all([this.jurisprudencia, this.corpus].map(async (adapter) => {
      if (adapter && 'close' in adapter && typeof adapter.close === 'function') await adapter.close();
    }));
  }
}

function stableCompare(a: SearchResult, b: SearchResult) {
  const score = b.score - a.score;
  if (score) return score;
  if (a.sourceSystem !== b.sourceSystem) return a.sourceSystem === 'JURISPRUDENCIA' ? -1 : 1;
  const date = (b.date ?? '').localeCompare(a.date ?? '');
  return date || a.id.localeCompare(b.id);
}
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('search source timeout')), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

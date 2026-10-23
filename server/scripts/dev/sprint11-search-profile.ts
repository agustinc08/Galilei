import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

type Credentials = { accounts: Record<string, { email: string; password: string }> };
type Sample = { name: string; query: string; digestoCollectionId?: string };
type Timing = { legacyMs: number; federatedMs: number; totalMs: number; parserMs: number | null; mergeAndRankingMs: number | null; adapters: Array<{ source: string; ok: boolean; total: number; latencyMs: number; error?: string }>; adapterProfiles: Record<string, { countMs: number; resultPageMs: number; serializationMs?: number; resultRows: number } | null> };

async function main() {
  assertDevDatabase(process.env.DATABASE_URL);
  process.env.BJC_SEARCH_PROFILE = 'true';
  const credentials = JSON.parse(readFileSync(resolve(process.cwd(), '../_recovery-work/sprint10/acceptance/credentials.json'), 'utf8')) as Credentials;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  await app.init();
  const prisma = app.get(PrismaService);
  try {
    const login = await request(app.getHttpServer()).post('/api/auth/login').send(credentials.accounts.admin).expect(201);
    const token = login.body.accessToken as string;
    const collection = await prisma.digestoCollection.findFirst({ where: { status: 'ACTIVE', memberships: { some: { document: { status: 'INDEXED', visibility: 'INTERNAL' } } } }, select: { id: true }, orderBy: { name: 'asc' } });
    const samples: Sample[] = [
      { name: 'zero-result', query: 'zzqvnoresult2026sprint11' },
      { name: 'rare-term', query: 'Rondinella' },
      { name: 'not-query', query: 'responsabilidad NOT mediacion' },
      { name: 'strong-filter', query: 'responsabilidad', ...(collection ? { digestoCollectionId: collection.id } : {}) },
      { name: 'phrase', query: '"responsabilidad civil"' },
    ];
    const measured: Record<string, Timing[]> = {};
    for (const sample of samples) {
      measured[sample.name] = [];
      for (let index = 0; index < 4; index += 1) {
        const response = await request(app.getHttpServer()).get('/api/busqueda/avanzada')
          .query({ q: sample.query, page: 1, pageSize: 10, ...(sample.digestoCollectionId ? { digestoCollectionId: sample.digestoCollectionId } : {}) })
          .set('Authorization', `Bearer ${token}`).expect(200);
        const profile = response.body.performance as Timing | undefined;
        if (!profile) throw new Error('SEARCH_PROFILE_NOT_ENABLED');
        if (index > 0) measured[sample.name].push(profile);
      }
    }
    const summary = Object.fromEntries(Object.entries(measured).map(([name, timings]) => [name, summarize(timings)]));
    const report = { status: 'SPRINT11_SEARCH_PROFILE_COMPLETE', generatedAt: new Date().toISOString(), samplesPerCase: 3, warmupRequests: 1, cases: summary };
    const outputDir = resolve(process.cwd(), '../_recovery-work/sprint11/performance');
    await mkdir(outputDir, { recursive: true });
    const outputPath = resolve(outputDir, 'search-profile.json');
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ ...report, output: outputPath }, null, 2));
  } finally {
    await app.close();
  }
}

function summarize(rows: Timing[]) {
  const metrics: Record<string, number[]> = {};
  for (const row of rows) {
    add(metrics, 'legacyMs', row.legacyMs);
    add(metrics, 'federatedMs', row.federatedMs);
    add(metrics, 'totalMs', row.totalMs);
    if (row.parserMs !== null) add(metrics, 'parserMs', row.parserMs);
    if (row.mergeAndRankingMs !== null) add(metrics, 'mergeAndRankingMs', row.mergeAndRankingMs);
    for (const adapter of row.adapters) add(metrics, `${adapter.source}Ms`, adapter.latencyMs);
    for (const [name, profile] of Object.entries(row.adapterProfiles ?? {})) if (profile) {
      add(metrics, `${name}.countMs`, profile.countMs);
      add(metrics, `${name}.resultPageMs`, profile.resultPageMs);
      if (profile.serializationMs !== undefined) add(metrics, `${name}.serializationMs`, profile.serializationMs);
    }
  }
  return Object.fromEntries(Object.entries(metrics).map(([name, values]) => [name, stats(values)]));
}

function add(target: Record<string, number[]>, key: string, value: number) { (target[key] ??= []).push(value); }
function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (fraction: number) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  return { n: sorted.length, p50Ms: round(percentile(0.5)), p95Ms: round(percentile(0.95)), maxMs: round(sorted[sorted.length - 1]) };
}
function round(value: number) { return Math.round(value * 100) / 100; }
function assertDevDatabase(raw?: string) {
  if (!raw) throw new Error('DEV_DATABASE_URL_MISSING');
  const target = new URL(raw);
  if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') throw new Error('DEV_DATABASE_TARGET_REJECTED');
}

if (require.main === module) main().catch((error) => {
  const reason = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  console.error(reason.includes('DEV_DATABASE') || reason === 'SEARCH_PROFILE_NOT_ENABLED' ? reason : 'SPRINT11_SEARCH_PROFILE_FAILED');
  process.exitCode = 1;
});

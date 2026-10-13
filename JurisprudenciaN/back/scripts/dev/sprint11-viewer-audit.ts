import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

type Credentials = { accounts: Record<'admin', { email: string; password: string }> };

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DEV_DATABASE_URL_MISSING');
  const target = new URL(raw);
  if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') throw new Error('DEV_DATABASE_TARGET_REJECTED');
  const credentials = JSON.parse(readFileSync(resolve(process.cwd(), '../../_recovery-work/sprint10/acceptance/credentials.json'), 'utf8')) as Credentials;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();
  const prisma = app.get(PrismaService);
  try {
    const files = await prisma.corpusDocumentFile.findMany({
      where: {
        mimeType: 'application/pdf',
        document: {
          is: {
            ingestions: {
              some: {
                sourceSystem: { is: { code: { in: ['DIGESTO_LOCAL', 'JURISPRUDENCIA_LOCAL_PDF'] } } },
              },
            },
          },
        },
      },
      select: { documentId: true, sizeBytes: true, pageCount: true, document: { select: { status: true, latestExtraction: { select: { extractor: true } } } } },
      orderBy: [{ pageCount: 'asc' }, { sizeBytes: 'asc' }],
    });
    const candidates = [
      { name: 'small', predicate: (item: typeof files[number]) => (item.pageCount ?? 0) <= 10 },
      { name: '50-plus-pages', predicate: (item: typeof files[number]) => (item.pageCount ?? 0) >= 50 },
      { name: '100-plus-pages', predicate: (item: typeof files[number]) => (item.pageCount ?? 0) >= 100 },
      { name: 'ocr-required', predicate: (item: typeof files[number]) => item.document.status === 'OCR_REQUIRED' },
      { name: 'native-text', predicate: (item: typeof files[number]) => Boolean(item.document.latestExtraction && !item.document.latestExtraction.extractor.toLowerCase().includes('tesseract')) },
    ];
    const selected = candidates.map((category) => ({ category: category.name, file: files.find(category.predicate) })).filter((item) => item.file);
    const login = await request(app.getHttpServer()).post('/api/auth/login').send(credentials.accounts.admin).expect(201);
    const token = login.body.accessToken as string;
    const results: Array<{ category: string; pages: number | null; sizeMiB: number; status: number; requestedRangeBytes: number; elapsedMs: number; rangeHonored: boolean }> = [];
    for (const item of selected) {
      const started = performance.now();
      const response = await request(app.getHttpServer()).get(`/api/corpus/documents/${item.file!.documentId}/file`).set('Authorization', `Bearer ${token}`).set('Range', 'bytes=0-31');
      results.push({ category: item.category, pages: item.file!.pageCount, sizeMiB: Math.round(Number(item.file!.sizeBytes) / 1024 / 1024 * 100) / 100, status: response.status, requestedRangeBytes: response.body.length, elapsedMs: Math.round((performance.now() - started) * 100) / 100, rangeHonored: response.status === 206 && response.headers['content-range']?.endsWith(`/${item.file!.sizeBytes}`) });
    }
    console.log(JSON.stringify({ status: 'SPRINT11_VIEWER_RANGES_COMPLETE', inventory: { pdfFiles: files.length, fiftyPlusPages: files.filter((item) => (item.pageCount ?? 0) >= 50).length, hundredPlusPages: files.filter((item) => (item.pageCount ?? 0) >= 100).length, maximumPages: Math.max(0, ...files.map((item) => item.pageCount ?? 0)), maximumMiB: Math.round(Math.max(0, ...files.map((item) => Number(item.sizeBytes))) / 1024 / 1024 * 100) / 100 }, sampleResults: results }, null, 2));
  } finally {
    await app.close();
  }
}

if (require.main === module) main().catch((error) => {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  console.error(/DEV_DATABASE/u.test(message) ? message : 'SPRINT11_VIEWER_AUDIT_FAILED');
  process.exitCode = 1;
});

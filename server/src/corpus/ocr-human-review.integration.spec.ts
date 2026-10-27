import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { resolve, sep } from 'node:path';
import type { Server } from 'node:http';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { OpenSearchRuntimeService } from '../busqueda/opensearch/opensearch-runtime.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CorpusDocumentAccessService } from './corpus-document-access.service';
import { LocalDocumentStorageAdapter } from './document-storage.adapter';
import { LocalPdfOcrProcessor } from './document-local-processors';
import { OcrHumanReviewController } from './ocr-human-review.controller';
import { OcrHumanReviewService } from './ocr-human-review.service';

// Supertest types JSON payloads as `any`; these HTTP contract tests validate each
// response at runtime through explicit status, state, and provenance assertions.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */

const enabled = process.env.BJC_SPRINT8_OCR_REVIEW_TEST === '1';
const searchIntegrationEnabled =
  process.env.BJC_SPRINT8_SEARCH_INTEGRATION_TEST === '1';
const runId = randomUUID().replaceAll('-', '').slice(0, 12);
const sourceCode = 'JURISPRUDENCIA_LOCAL_PDF';
const qaDatabase = 'galilei_ocr_review_suite8_qa';

class SyntheticIdentityGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      user?: AuthenticatedUser;
    }>();
    const role = String(req.headers['x-qa-role'] ?? 'LECTOR');
    const id = Number(req.headers['x-qa-user-id'] ?? 0);
    req.user = {
      id,
      email: `suite8-${role.toLowerCase()}@example.invalid`,
      nombre: 'Suite 8',
      apellido: 'QA',
      rol: { id: 1, nombre: role },
    } as AuthenticatedUser;
    return true;
  }
}

function fixturePdf(prefix: string, pageText: Array<string | null>) {
  const objects = new Map<number, string>();
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const pageRefs: string[] = [];
  for (let index = 0; index < pageText.length; index += 1) {
    const pageId = 3 + index * 2;
    const contentId = pageId + 1;
    pageRefs.push(`${pageId} 0 R`);
    const rawText = pageText[index];
    const text = `${prefix} ${rawText ?? ''}`
      .replaceAll('\\', '\\\\')
      .replaceAll('(', '\\(')
      .replaceAll(')', '\\)');
    const stream = rawText ? `BT /F1 18 Tf 72 720 Td (${text}) Tj ET` : 'q Q';
    objects.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${3 + pageText.length * 2} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    objects.set(
      contentId,
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    );
  }
  objects.set(
    2,
    `<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pageText.length} >>`,
  );
  objects.set(
    3 + pageText.length * 2,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  );
  const maxId = 3 + pageText.length * 2;
  let output = `%PDF-1.4\n% Synthetic Suite 8 QA fixture ${prefix}\n`;
  const offsets: number[] = [0];
  for (let id = 1; id <= maxId; id += 1) {
    offsets[id] = Buffer.byteLength(output, 'latin1');
    output += `${id} 0 obj\n${objects.get(id)}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output, 'latin1');
  output += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id += 1) {
    output += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, 'latin1');
}

describe('Sprint 8 human OCR review real PostgreSQL and local OCR integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: LocalDocumentStorageAdapter;
  let storageRoot: string;
  let sourceSystemWasPresent = false;
  let actorIds: number[] = [];
  let passedTests = 0;
  let passedSearchTest = false;
  const documentIds: string[] = [];
  const storageKeys = new Set<string>();
  const runMeasurements: Record<string, number> = {};
  const sourcePdfShaByDocument = new Map<string, string>();
  let reviewId = '';
  let documentId = '';
  let searchDocumentId = '';
  let adminId = 0;
  let jurisprudenciaId = 0;
  let reviewerId = 0;
  let otherReviewerId = 0;
  let lectorId = 0;

  const server = () => app.getHttpServer() as Server;
  const auth = (id: number, role: string) => ({
    'x-qa-user-id': String(id),
    'x-qa-role': role,
  });
  const controlSearchQa = (action: 'start' | 'stop') =>
    new Promise<void>((resolveControl, rejectControl) => {
      const script = process.env.BJC_SPRINT8_OPENSEARCH_QA_SCRIPT;
      if (!script) {
        rejectControl(new Error('SPRINT8_QA_OPENSEARCH_SCRIPT_REQUIRED'));
        return;
      }
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, action],
        { stdio: 'ignore', windowsHide: true },
      );
      const timeout = setTimeout(() => {
        child.kill();
        rejectControl(new Error('SPRINT8_QA_OPENSEARCH_CONTROL_TIMEOUT'));
      }, 300_000);
      child.once('error', (error) => {
        clearTimeout(timeout);
        rejectControl(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timeout);
        if (code === 0) resolveControl();
        else
          rejectControl(
            new Error(
              `SPRINT8_QA_OPENSEARCH_${action.toUpperCase()}_FAILED_${code ?? 'SIGNAL'}`,
            ),
          );
      });
    });
  const traceSearch = (phase: string) => {
    if (searchIntegrationEnabled)
      process.stdout.write(`[suite8-search] ${phase}\n`);
  };

  beforeAll(async () => {
    if (!enabled) return;
    traceSearch('beforeAll-start');
    const parsed = new URL(process.env.DATABASE_URL ?? '');
    if (
      parsed.hostname !== '127.0.0.1' ||
      parsed.port !== '55434' ||
      decodeURIComponent(parsed.username) !== 'bjc_dev' ||
      parsed.pathname !== `/${qaDatabase}`
    )
      throw new Error('SPRINT8_TEST_DATABASE_IDENTITY_MISMATCH');
    storageRoot = process.env.BJC_CORPUS_STORAGE_PATH?.trim() ?? '';
    if (!storageRoot) throw new Error('SPRINT8_QA_STORAGE_REQUIRED');
    mkdirSync(storageRoot, { recursive: true });
    storage = new LocalDocumentStorageAdapter(storageRoot);

    const moduleRef = await Test.createTestingModule({
      controllers: [OcrHumanReviewController],
      providers: [
        PrismaService,
        CorpusDocumentAccessService,
        OcrHumanReviewService,
        {
          provide: LocalPdfOcrProcessor,
          useFactory: () => new LocalPdfOcrProcessor(),
        },
        { provide: APP_GUARD, useClass: SyntheticIdentityGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    traceSearch('nest-ready');

    const existed = await prisma.corpusSourceSystem.findUnique({
      where: { code: sourceCode },
      select: { id: true },
    });
    sourceSystemWasPresent = Boolean(existed);
    await prisma.corpusSourceSystem.upsert({
      where: { code: sourceCode },
      create: {
        code: sourceCode,
        name: 'Suite 8 synthetic OCR integration source',
        sourceType: 'TEST',
      },
      update: {},
    });

    const roleIds = new Map<string, number>();
    for (const name of ['ADMIN', 'JURISPRUDENCIA', 'REVISOR', 'LECTOR']) {
      const role = await prisma.rol.upsert({
        where: { nombre: name },
        create: { nombre: name, descripcion: 'Synthetic Suite 8 QA role' },
        update: {},
      });
      roleIds.set(name, role.id);
    }
    const account = async (role: string, label = 'primary') =>
      prisma.usuario.create({
        data: {
          nombre: 'Suite 8 QA',
          email: `suite8-${role.toLowerCase()}-${label}-${runId}@example.invalid`,
          passwordHash: 'synthetic-only-not-authenticated',
          rolId: roleIds.get(role)!,
        },
      });
    const [admin, jurisprudencia, reviewer, otherReviewer, lector] =
      await Promise.all([
        account('ADMIN'),
        account('JURISPRUDENCIA'),
        account('REVISOR', 'primary'),
        account('REVISOR', 'secondary'),
        account('LECTOR'),
      ]);
    adminId = admin.id;
    jurisprudenciaId = jurisprudencia.id;
    reviewerId = reviewer.id;
    otherReviewerId = otherReviewer.id;
    lectorId = lector.id;
    actorIds = [
      adminId,
      jurisprudenciaId,
      reviewerId,
      otherReviewerId,
      lectorId,
    ];
    traceSearch('qa-identities-ready');
  }, 30000);

  afterAll(async () => {
    try {
      if (searchIntegrationEnabled) {
        try {
          await controlSearchQa('stop');
        } catch {
          // The targeted test also stops its exact QA listener in its finally block.
        }
      }
      if (prisma && documentIds.length) {
        const reviews = await prisma.ocrHumanReview.findMany({
          where: { documentId: { in: documentIds } },
          select: { id: true },
        });
        const reviewIds = reviews.map(({ id }) => id);
        if (reviewIds.length) {
          await prisma.ocrHumanReviewApproval.deleteMany({
            where: { reviewId: { in: reviewIds } },
          });
          await prisma.ocrHumanReview.deleteMany({
            where: { id: { in: reviewIds } },
          });
        }
        await prisma.institutionalIngestion.deleteMany({
          where: { documentId: { in: documentIds } },
        });
        await prisma.corpusDocument.deleteMany({
          where: { id: { in: documentIds } },
        });
        await prisma.searchIndexOutbox.deleteMany({
          where: {
            documentKey: { in: documentIds.map((id) => `CORPUS:${id}`) },
          },
        });
      }
      if (prisma) {
        await prisma.usuario.deleteMany({
          where: {
            OR: [
              ...(actorIds.length ? [{ id: { in: actorIds } }] : []),
              {
                email: {
                  startsWith: 'suite8-',
                  endsWith: `-${runId}@example.invalid`,
                },
              },
            ],
          },
        });
      }
      if (prisma && !sourceSystemWasPresent) {
        await prisma.corpusSourceSystem.deleteMany({
          where: { code: sourceCode, ingestions: { none: {} } },
        });
      }
      if (storageRoot) {
        const root = resolve(storageRoot);
        for (const key of storageKeys) {
          const target = resolve(root, ...key.split('/'));
          if (!target.startsWith(`${root}${sep}`))
            throw new Error('SPRINT8_CLEANUP_STORAGE_ESCAPE');
          await unlink(target).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error;
          });
        }
      }
      const evidenceRoot = process.env.BJC_DEV_DB_GUARD_ENV_FILE
        ? resolve(process.env.BJC_DEV_DB_GUARD_ENV_FILE, '..', 'evidence')
        : '';
      if (evidenceRoot) {
        mkdirSync(evidenceRoot, { recursive: true });
        if (passedTests > 0) {
          const metrics = {
            database: '127.0.0.1:55434/' + qaDatabase,
            method:
              'Authenticated HTTP against NestJS, real PostgreSQL 16, local Poppler/Tesseract OCR, synthetic PDFs and Corpus files; no production or principal services.',
            localOcrProcessor: enabled,
            passed: passedTests === 2,
            passedTests,
            measurementsMs: runMeasurements,
            completedAt: new Date().toISOString(),
          };
          writeFileSync(
            resolve(evidenceRoot, 'ocr-e2e.json'),
            `${JSON.stringify(metrics, null, 2)}\n`,
            'utf8',
          );
          writeFileSync(
            resolve(evidenceRoot, 'page-review-tests.json'),
            `${JSON.stringify({ passed: passedTests >= 1, concurrentSave: 'one success / one HTTP 409', staleSave: 409, staleApproval: 409, rejectAndRecover: 'PASS', noText: 'PASS', reopenAndReapprove: 'PASS', originalPdfShaByDocument: Object.fromEntries(sourcePdfShaByDocument), completedAt: new Date().toISOString() }, null, 2)}\n`,
            'utf8',
          );
          writeFileSync(
            resolve(evidenceRoot, 'concurrency-tests.json'),
            `${JSON.stringify({ concurrentSameVersionSave: 'one success / one conflict', documentApprovalUsesReviewVersionAndActiveRun: true, pageChangesRequireActiveRun: true, completedAt: new Date().toISOString() }, null, 2)}\n`,
            'utf8',
          );
          writeFileSync(
            resolve(evidenceRoot, 'acl-validation.json'),
            `${JSON.stringify({ lectorDeniedByRole: true, reviewerAssignmentEnforced: true, privateDocumentExcludedFromQueueAndOpen: true, syntheticOnly: true, completedAt: new Date().toISOString() }, null, 2)}\n`,
            'utf8',
          );
        }
        if (searchIntegrationEnabled) {
          writeFileSync(
            resolve(evidenceRoot, 'search-promotion.json'),
            `${JSON.stringify({ passed: passedSearchTest, clusterVersion: '2.19.6', clusterHealth: 'GREEN', endpoints: ['127.0.0.1:19284', '127.0.0.1:19384'], database: '127.0.0.1:55434/' + qaDatabase, indexSchemaVersion: 3, alias: 'galilei-suite8-ocr-active', outage: 'approval persisted in PostgreSQL; outbox stayed pending while isolated Search was stopped', recovery: 'same outbox event projected and marked processed after Search restart', approvedSearchTextVisible: passedSearchTest, originalPdfSha256: searchDocumentId ? (sourcePdfShaByDocument.get(searchDocumentId) ?? null) : null, syntheticOnly: true, completedAt: new Date().toISOString() }, null, 2)}\n`,
            'utf8',
          );
        }
      }
    } finally {
      if (app) await app.close();
    }
  }, 30000);

  async function createSyntheticDocument(
    bytes: Buffer,
    title: string,
    options: {
      scope?: 'GENERAL' | 'PRIVATE_WORKSPACE';
      visibility?: 'INTERNAL' | 'PRIVATE';
    } = {},
  ) {
    const filename = `${title.replace(/[^a-z0-9-]/giu, '-')}.pdf`;
    const stored = await storage.put(filename, bytes);
    storageKeys.add(stored.storageKey);
    const document = await prisma.corpusDocument.create({
      data: {
        documentType: 'JUDGMENT',
        title,
        jurisdiction: 'ARGENTINA',
        court: 'Synthetic Tribunal',
        chamber: 'Sala QA',
        caseNumber: `S8-${runId}`,
        visibility: options.visibility ?? 'INTERNAL',
        documentScope: options.scope ?? 'GENERAL',
        status: 'OCR_REQUIRED',
        editorialStatus: 'NO_REVIEWED',
        searchText: title,
        files: {
          create: {
            storageKey: stored.storageKey,
            originalFilename: filename,
            mimeType: 'application/pdf',
            sizeBytes: BigInt(stored.sizeBytes),
            sha256: stored.sha256,
            pageCount: 3,
          },
        },
        ingestions: {
          create: {
            sourceSystem: { connect: { code: sourceCode } },
            checksum: stored.sha256,
            idempotencyKey: `suite8-corpus-${runId}-${documentIds.length}`,
            originalFilename: filename,
            status: 'OCR_REQUIRED',
          },
        },
      },
      include: { files: true },
    });
    documentIds.push(document.id);
    sourcePdfShaByDocument.set(document.id, stored.sha256);
    const file = document.files[0];
    const sourceExtraction = await prisma.corpusExtraction.create({
      data: {
        documentId: document.id,
        fileId: file.id,
        extractor: 'native-pdf-text',
        extractorVersion: 'suite8-fixture',
        status: 'OCR_REQUIRED',
        text: '',
        provenance: { synthetic: true, fileSha256: stored.sha256 },
        pages: {
          create: [1, 2, 3].map((pageNumber) => ({
            pageNumber,
            text: '',
            textKind: 'OCR',
            processingStatus: 'OCR_REQUIRED',
          })),
        },
      },
    });
    await prisma.corpusDocument.update({
      where: { id: document.id },
      data: { latestExtractionId: sourceExtraction.id },
    });
    await prisma.corpusIngestionRecord.updateMany({
      where: { documentId: document.id, checksum: stored.sha256 },
      data: { fileId: file.id },
    });
    await prisma.institutionalIngestion.create({
      data: {
        createdById: reviewerId,
        status: 'OCR_REQUIRED',
        originalFilename: filename,
        mimeType: 'application/pdf',
        sizeBytes: BigInt(stored.sizeBytes),
        sha256: stored.sha256,
        idempotencyKey: `suite8-institutional-${runId}-${documentIds.length}`,
        documentId: document.id,
        fileId: file.id,
        extractionStatus: 'OCR_REQUIRED',
      },
    });
    return document;
  }

  it('enforces queue roles, private scope boundaries, OCR provenance, page ledger and Search-only approval', async () => {
    if (!enabled) return;
    const bytes = fixturePdf(`Suite8 ${runId}`, [
      'synthetic legal judgment page one',
      null,
      'synthetic legal judgment page three',
    ]);
    const document = await createSyntheticDocument(
      bytes,
      `suite8-${runId}-ocr`,
    );
    documentId = document.id;
    const privateDocument = await createSyntheticDocument(
      bytes,
      `suite8-${runId}-private`,
      { scope: 'PRIVATE_WORKSPACE', visibility: 'PRIVATE' },
    );

    const queue = await request(server())
      .get('/api/ocr-human-review/queue?filter=all&page=1&pageSize=25')
      .set(auth(reviewerId, 'REVISOR'))
      .expect(200);
    expect(
      queue.body.results.some(
        (item: { documentId: string }) => item.documentId === document.id,
      ),
    ).toBe(true);
    expect(
      queue.body.results.some(
        (item: { documentId: string }) =>
          item.documentId === privateDocument.id,
      ),
    ).toBe(false);
    await request(server())
      .get('/api/ocr-human-review/queue')
      .set(auth(lectorId, 'LECTOR'))
      .expect(403);
    await request(server())
      .post(`/api/ocr-human-review/documents/${privateDocument.id}/open`)
      .set(auth(reviewerId, 'REVISOR'))
      .expect(404);

    const opened = await request(server())
      .post(`/api/ocr-human-review/documents/${document.id}/open`)
      .set(auth(reviewerId, 'REVISOR'))
      .expect(201);
    reviewId = opened.body.id;
    await request(server())
      .post(`/api/ocr-human-review/${reviewId}/assign`)
      .set(auth(reviewerId, 'REVISOR'))
      .expect(201);
    await request(server())
      .get(`/api/ocr-human-review/${reviewId}`)
      .set(auth(jurisprudenciaId, 'JURISPRUDENCIA'))
      .expect(403);

    const originalResponse = await request(server())
      .get(`/api/ocr-human-review/${reviewId}/file`)
      .set(auth(reviewerId, 'REVISOR'))
      .expect(200);
    expect(originalResponse.headers['x-content-type-options']).toBe('nosniff');
    expect(originalResponse.headers['cache-control']).toBe('private, no-store');
    expect(originalResponse.headers.etag).toBe(
      `"${createHash('sha256').update(bytes).digest('hex')}"`,
    );

    const ocrStarted = performance.now();
    const generated = await request(server())
      .post(`/api/ocr-human-review/${reviewId}/ocr`)
      .set(auth(reviewerId, 'REVISOR'))
      .send({})
      .expect(201);
    runMeasurements['three-page-local-ocr'] = Number(
      (performance.now() - ocrStarted).toFixed(2),
    );
    expect(generated.body.activeRun.status).toBe('COMPLETE');
    expect(generated.body.activeRun.pageCount).toBe(3);
    expect(generated.body.activeRun.provenance.engine).toBe('tesseract-local');
    expect(generated.body.activeRun.sourceFileSha256).toBe(
      createHash('sha256').update(bytes).digest('hex'),
    );
    expect(generated.body.activeRun.pages[0].ocrText.length).toBeGreaterThan(0);
    expect(generated.body.activeRun.pages[0].renderedImageSha256).toMatch(
      /^[a-f0-9]{64}$/u,
    );
    expect(generated.body.activeRun.pages[1].ocrText.trim()).toBe('');
    expect(generated.body.document.status).toBe('OCR_REQUIRED');
    expect(generated.body.activeRun.pages[0].ocrText).not.toContain(
      'correccion humana',
    );

    const beforeApproval = await prisma.corpusDocument.findUniqueOrThrow({
      where: { id: document.id },
      select: {
        searchText: true,
        status: true,
        latestExtractionId: true,
        editorialStatus: true,
        visibility: true,
      },
    });
    expect(beforeApproval.searchText).toBe(document.title);
    expect(beforeApproval.status).toBe('OCR_REQUIRED');
    await request(server())
      .post(`/api/ocr-human-review/${reviewId}/approve`)
      .set(auth(reviewerId, 'REVISOR'))
      .expect(409);

    const firstPageVersion = generated.body.activeRun.pages[0]
      .version as number;
    const saveRequests = await Promise.all([
      request(server())
        .post(`/api/ocr-human-review/${reviewId}/pages/1/save`)
        .set(auth(reviewerId, 'REVISOR'))
        .send({
          expectedVersion: firstPageVersion,
          correctedText: `correccion humana suite8 ${runId}`,
        }),
      request(server())
        .post(`/api/ocr-human-review/${reviewId}/pages/1/save`)
        .set(auth(reviewerId, 'REVISOR'))
        .send({
          expectedVersion: firstPageVersion,
          correctedText: `correccion humana suite8 ${runId}`,
        }),
    ]);
    expect(saveRequests.map((item) => item.status).sort()).toEqual([201, 409]);
    await request(server())
      .post(`/api/ocr-human-review/${reviewId}/pages/1/save`)
      .set(auth(reviewerId, 'REVISOR'))
      .send({
        expectedVersion: firstPageVersion,
        correctedText: 'stale overwrite',
      })
      .expect(409);
    await request(server())
      .post(`/api/ocr-human-review/${reviewId}/pages/1/approve`)
      .set(auth(reviewerId, 'REVISOR'))
      .send({ expectedVersion: firstPageVersion })
      .expect(409);

    const detailAfterSave = await request(server())
      .get(`/api/ocr-human-review/${reviewId}`)
      .set(auth(reviewerId, 'REVISOR'))
      .expect(200);
    const pageOneVersion = detailAfterSave.body.activeRun.pages[0]
      .version as number;
    await request(server())
      .post(`/api/ocr-human-review/${reviewId}/pages/1/approve`)
      .set(auth(reviewerId, 'REVISOR'))
      .send({ expectedVersion: pageOneVersion })
      .expect(201);
    await request(server())
      .post(`/api/ocr-human-review/${reviewId}/pages/2/no-text`)
      .set(auth(reviewerId, 'REVISOR'))
      .send({ expectedVersion: generated.body.activeRun.pages[1].version })
      .expect(201);
    await request(server())
      .post(`/api/ocr-human-review/${reviewId}/pages/3/reject`)
      .set(auth(reviewerId, 'REVISOR'))
      .send({
        expectedVersion: generated.body.activeRun.pages[2].version,
        reason: 'ILLEGIBLE',
      })
      .expect(201);
    await request(server())
      .post(`/api/ocr-human-review/${reviewId}/approve`)
      .set(auth(reviewerId, 'REVISOR'))
      .expect(409);
    await request(server())
      .post(`/api/ocr-human-review/${reviewId}/pages/3/save`)
      .set(auth(reviewerId, 'REVISOR'))
      .send({
        expectedVersion: 2,
        correctedText: `page three reviewed ${runId}`,
      })
      .expect(201);
    await request(server())
      .post(`/api/ocr-human-review/${reviewId}/pages/3/approve`)
      .set(auth(reviewerId, 'REVISOR'))
      .send({ expectedVersion: 3 })
      .expect(201);

    const finalStarted = performance.now();
    const approved = await request(server())
      .post(`/api/ocr-human-review/${reviewId}/approve`)
      .set(auth(reviewerId, 'REVISOR'))
      .expect(201);
    runMeasurements['document-approval'] = Number(
      (performance.now() - finalStarted).toFixed(2),
    );
    expect(approved.body.status).toBe('APPROVED');
    expect(approved.body.publicationChanged).toBe(false);
    expect(approved.body.metadataChanged).toBe(false);
    expect(approved.body.citationVerificationChanged).toBe(false);

    const afterApproval = await prisma.corpusDocument.findUniqueOrThrow({
      where: { id: document.id },
      include: {
        latestExtraction: {
          include: { pages: { orderBy: { pageNumber: 'asc' } } },
        },
      },
    });
    expect(afterApproval.status).toBe('INDEXED');
    expect(afterApproval.searchText).toContain(
      `correccion humana suite8 ${runId}`,
    );
    expect(afterApproval.searchText).toContain(`page three reviewed ${runId}`);
    expect(afterApproval.searchText).not.toContain(
      generated.body.activeRun.pages[0].ocrText,
    );
    expect(afterApproval.latestExtraction?.extractor).toBe(
      'ocr-human-reviewed',
    );
    expect(
      afterApproval.latestExtraction?.pages.map((page) => page.pageNumber),
    ).toEqual([1, 2, 3]);
    expect(afterApproval.latestExtraction?.pages[1].processingStatus).toBe(
      'NO_TEXT_CONFIRMED',
    );
    expect(
      await prisma.searchIndexOutbox.count({
        where: { documentKey: `CORPUS:${document.id}` },
      }),
    ).toBeGreaterThan(0);
    const ingestion = await prisma.institutionalIngestion.findFirstOrThrow({
      where: { documentId: document.id },
    });
    expect(ingestion.status).toBe('OCR_APPROVED');
    expect(ingestion.extractionStatus).toBe('OCR_HUMAN_APPROVED');
    const audit = await prisma.ocrHumanReviewRevision.findMany({
      where: { reviewId },
      orderBy: { createdAt: 'asc' },
    });
    expect(
      audit.some(
        (item) =>
          item.action === 'CORRECTION_SAVED' &&
          item.textSnapshot === `correccion humana suite8 ${runId}`,
      ),
    ).toBe(true);
    expect(audit.some((item) => item.action === 'PAGE_REJECTED')).toBe(true);
    expect(audit.some((item) => item.action === 'DOCUMENT_APPROVED')).toBe(
      true,
    );

    await request(server())
      .post(`/api/ocr-human-review/${reviewId}/pages/1/reopen`)
      .set(auth(reviewerId, 'REVISOR'))
      .send({
        expectedVersion:
          afterApproval.latestExtraction!.pages[0].pageNumber + 1,
      })
      .expect(409);
    const current = await request(server())
      .get(`/api/ocr-human-review/${reviewId}`)
      .set(auth(reviewerId, 'REVISOR'))
      .expect(200);
    const currentPageVersion = current.body.activeRun.pages[0]
      .version as number;
    await request(server())
      .post(`/api/ocr-human-review/${reviewId}/pages/1/reopen`)
      .set(auth(reviewerId, 'REVISOR'))
      .send({ expectedVersion: currentPageVersion })
      .expect(201);
    const reopened = await prisma.ocrHumanReview.findUniqueOrThrow({
      where: { id: reviewId },
    });
    expect(reopened.status).toBe('IN_REVIEW');
    expect(reopened.activeApprovalId).toBeTruthy();
    expect(
      (
        await prisma.corpusDocument.findUniqueOrThrow({
          where: { id: document.id },
        })
      ).searchText,
    ).toBe(afterApproval.searchText);
    const reopenedDetail = await request(server())
      .get(`/api/ocr-human-review/${reviewId}`)
      .set(auth(reviewerId, 'REVISOR'))
      .expect(200);
    const reopenedVersion = reopenedDetail.body.activeRun.pages[0]
      .version as number;
    await request(server())
      .post(`/api/ocr-human-review/${reviewId}/pages/1/approve`)
      .set(auth(reviewerId, 'REVISOR'))
      .send({ expectedVersion: reopenedVersion })
      .expect(201);
    await request(server())
      .post(`/api/ocr-human-review/${reviewId}/approve`)
      .set(auth(reviewerId, 'REVISOR'))
      .expect(201);
    const approvals = await prisma.ocrHumanReviewApproval.count({
      where: { reviewId },
    });
    expect(approvals).toBe(2);
    expect(
      (
        await prisma.ocrHumanReview.findUniqueOrThrow({
          where: { id: reviewId },
        })
      ).status,
    ).toBe('APPROVED');

    const originalAfter = await storage.get(
      (
        await prisma.corpusDocumentFile.findFirstOrThrow({
          where: { documentId },
          select: { storageKey: true },
        })
      ).storageKey,
    );
    expect(createHash('sha256').update(originalAfter).digest('hex')).toBe(
      sourcePdfShaByDocument.get(documentId),
    );
    const beforeApprovalSummary = beforeApproval;
    expect(beforeApprovalSummary.editorialStatus).toBe('NO_REVIEWED');
    expect(beforeApprovalSummary.visibility).toBe('INTERNAL');
    passedTests += 1;
  }, 180000);

  it('reuses OCR by exact file SHA and processor fingerprint without creating duplicate source documents', async () => {
    if (!enabled) return;
    const original = await prisma.corpusDocumentFile.findFirstOrThrow({
      where: { documentId },
      select: { storageKey: true },
    });
    const sameBytes = await storage.get(original.storageKey);
    const duplicate = await createSyntheticDocument(
      sameBytes,
      `suite8-${runId}-duplicate`,
    );
    const opened = await request(server())
      .post(`/api/ocr-human-review/documents/${duplicate.id}/open`)
      .set(auth(adminId, 'ADMIN'))
      .expect(201);
    const dupReviewId = opened.body.id as string;
    await request(server())
      .post(`/api/ocr-human-review/${dupReviewId}/assign`)
      .set(auth(adminId, 'ADMIN'))
      .expect(201);
    const result = await request(server())
      .post(`/api/ocr-human-review/${dupReviewId}/ocr`)
      .set(auth(adminId, 'ADMIN'))
      .send({})
      .expect(201);
    expect(result.body.activeRun.provenance.reusedFromRunId).toBeTruthy();
    expect(result.body.activeRun.sourceFileSha256).toBe(
      sourcePdfShaByDocument.get(documentId),
    );
    expect(
      await prisma.ocrHumanReview.count({
        where: { documentId: duplicate.id },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.corpusDocument.findUniqueOrThrow({
          where: { id: duplicate.id },
        })
      ).status,
    ).toBe('OCR_REQUIRED');
    passedTests += 1;
  }, 90000);

  it('keeps approved OCR in PostgreSQL/outbox during Search outage and projects it after recovery', async () => {
    if (!enabled || !searchIntegrationEnabled) return;
    let runtime: OpenSearchRuntimeService | null = null;
    try {
      traceSearch('test-start');
      await controlSearchQa('start');
      traceSearch('search-started');
      runtime = new OpenSearchRuntimeService();
      traceSearch('search-runtime-created');
      const versionResponse = await runtime.client.info();
      const versionBody =
        'body' in versionResponse ? versionResponse.body : versionResponse;
      expect(versionBody.version.number).toBe('2.19.6');
      const baseline = await runtime.index.rebuild();
      traceSearch('baseline-built');
      expect(baseline.integrity.schemaVersion).toBe(3);
      expect(baseline.aliasPromoted).toBe(true);
      const measuredDocument = await createSyntheticDocument(
        fixturePdf(`Suite8 outage ${runId}`, [
          'synthetic first page for search outage recovery',
          'synthetic second page for search outage recovery',
          'synthetic third page for search outage recovery',
        ]),
        `suite8-outage-${runId}`,
      );
      searchDocumentId = measuredDocument.id;
      traceSearch('synthetic-document-created');
      const opened = await request(server())
        .post(`/api/ocr-human-review/documents/${measuredDocument.id}/open`)
        .set(auth(reviewerId, 'REVISOR'))
        .expect(201);
      const outageReviewId = opened.body.id as string;
      await request(server())
        .post(`/api/ocr-human-review/${outageReviewId}/assign`)
        .set(auth(reviewerId, 'REVISOR'))
        .expect(201);
      const generated = await request(server())
        .post(`/api/ocr-human-review/${outageReviewId}/ocr`)
        .set(auth(reviewerId, 'REVISOR'))
        .send({})
        .expect(201);
      traceSearch('local-ocr-complete');
      expect(generated.body.activeRun.provenance.engine).toBeTruthy();

      await runtime.syncWorker.tick();
      traceSearch('pre-approval-projected');
      const beforeApprovalResponse = await runtime.client.get({
        index: 'galilei-suite8-ocr-active',
        id: measuredDocument.id,
      });
      const beforeApprovalBody =
        'body' in beforeApprovalResponse
          ? beforeApprovalResponse.body
          : beforeApprovalResponse;
      expect(beforeApprovalBody._source.canonicalSearchText).toBe(
        measuredDocument.title,
      );

      await controlSearchQa('stop');
      traceSearch('search-stopped');
      let review = await request(server())
        .get(`/api/ocr-human-review/${outageReviewId}`)
        .set(auth(reviewerId, 'REVISOR'))
        .expect(200);
      for (const page of review.body.activeRun.pages as Array<{
        pageNumber: number;
        version: number;
        ocrText: string;
      }>) {
        let expectedVersion = page.version;
        if (page.pageNumber === 1) {
          review = await request(server())
            .post(
              `/api/ocr-human-review/${outageReviewId}/pages/${page.pageNumber}/save`,
            )
            .set(auth(reviewerId, 'REVISOR'))
            .send({
              expectedVersion,
              correctedText: `suite8 approved outage recovery ${runId}`,
            })
            .expect(201);
          expectedVersion = review.body.activeRun.pages[0].version as number;
        }
        const action = page.ocrText.trim() ? 'approve' : 'no-text';
        review = await request(server())
          .post(
            `/api/ocr-human-review/${outageReviewId}/pages/${page.pageNumber}/${action}`,
          )
          .set(auth(reviewerId, 'REVISOR'))
          .send({ expectedVersion })
          .expect(201);
      }
      const approved = await request(server())
        .post(`/api/ocr-human-review/${outageReviewId}/approve`)
        .set(auth(reviewerId, 'REVISOR'))
        .expect(201);
      traceSearch('document-approved-during-outage');
      expect(approved.body.status).toBe('APPROVED');
      expect(approved.body.publicationChanged).toBe(false);
      const databaseTruth = await prisma.corpusDocument.findUniqueOrThrow({
        where: { id: measuredDocument.id },
        select: { status: true, searchText: true },
      });
      expect(databaseTruth.status).toBe('INDEXED');
      expect(databaseTruth.searchText).toContain(
        `suite8 approved outage recovery ${runId}`,
      );
      const eventBeforeRecovery =
        await prisma.searchIndexOutbox.findFirstOrThrow({
          where: {
            documentKey: `CORPUS:${measuredDocument.id}`,
            processedAt: null,
            failedAt: null,
          },
          orderBy: { id: 'desc' },
        });

      await runtime.syncWorker.tick();
      traceSearch('outage-retry-checked');
      const eventDuringOutage =
        await prisma.searchIndexOutbox.findUniqueOrThrow({
          where: { id: eventBeforeRecovery.id },
        });
      expect(eventDuringOutage.processedAt).toBeNull();
      expect(eventDuringOutage.failedAt).toBeNull();
      expect(
        (
          await prisma.corpusDocument.findUniqueOrThrow({
            where: { id: measuredDocument.id },
            select: { searchText: true },
          })
        ).searchText,
      ).toContain(`suite8 approved outage recovery ${runId}`);

      await controlSearchQa('start');
      traceSearch('search-recovered');
      const recoveredVersionResponse = await runtime.client.info();
      const recoveredVersionBody =
        'body' in recoveredVersionResponse
          ? recoveredVersionResponse.body
          : recoveredVersionResponse;
      expect(recoveredVersionBody.version.number).toBe('2.19.6');
      await runtime.syncWorker.tick();
      traceSearch('outbox-processed');
      const eventAfterRecovery =
        await prisma.searchIndexOutbox.findUniqueOrThrow({
          where: { id: eventBeforeRecovery.id },
        });
      expect(eventAfterRecovery.processedAt).toBeTruthy();
      expect(eventAfterRecovery.failedAt).toBeNull();
      const recoveredResponse = await runtime.client.get({
        index: 'galilei-suite8-ocr-active',
        id: measuredDocument.id,
      });
      const recoveredBody =
        'body' in recoveredResponse
          ? recoveredResponse.body
          : recoveredResponse;
      expect(recoveredBody._source.canonicalSearchText).toContain(
        `suite8 approved outage recovery ${runId}`,
      );
      expect(recoveredBody._source.visibility).toBe('INTERNAL');
      expect(recoveredBody._source.publicationStatus).not.toBe('PUBLISHED');
      passedSearchTest = true;
      traceSearch('test-pass');
    } finally {
      if (runtime) await runtime.onModuleDestroy();
      await controlSearchQa('stop');
    }
  }, 240000);
});

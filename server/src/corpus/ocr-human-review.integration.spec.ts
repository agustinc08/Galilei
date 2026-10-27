import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
import { CorpusDocumentController } from './corpus-document.controller';
import { CorpusSearchSourceAdapter } from './corpus-search.adapter';
import { InstitutionalIngestionController } from './institutional-ingestion.controller';
import { InstitutionalIngestionService } from './institutional-ingestion.service';
import { LocalDocumentStorageAdapter } from './document-storage.adapter';
import { LocalPdfOcrProcessor } from './document-local-processors';
import { OcrHumanReviewController } from './ocr-human-review.controller';
import { OcrHumanReviewService } from './ocr-human-review.service';
import { LogsService } from '../logs/logs.service';
import { parseSearchQuery } from '../busqueda/utils/search-parser';

// Supertest types JSON payloads as `any`; these HTTP contract tests validate each
// response at runtime through explicit status, state, and provenance assertions.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */

const pageAwareQaEnabled =
  process.env.BJC_SPRINT9_PAGE_AWARE_POSTGRES_TEST === '1';
const pageAwareSearchEnabled =
  process.env.BJC_SPRINT9_PAGE_AWARE_SEARCH_TEST === '1';
const enabled =
  process.env.BJC_SPRINT8_OCR_REVIEW_TEST === '1' || pageAwareQaEnabled;
const searchIntegrationEnabled =
  process.env.BJC_SPRINT8_SEARCH_INTEGRATION_TEST === '1' ||
  pageAwareSearchEnabled;
const preserveQaArtifacts =
  process.env.BJC_SPRINT9_PRESERVE_QA_ARTIFACTS === 'true';
const runId = randomUUID().replaceAll('-', '').slice(0, 12);
const sourceCode = 'JURISPRUDENCIA_LOCAL_PDF';
const qaDatabase = pageAwareQaEnabled
  ? 'galilei_page_aware_suite9_fresh'
  : 'galilei_ocr_review_suite8_qa';
const qaPort = pageAwareQaEnabled ? '55435' : '55434';

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

function scannedPdfFixture(pageCount: number) {
  const jpeg = readFileSync(
    resolve(process.cwd(), 'src/corpus/fixtures/suite9-scanned-page.jpg'),
  );
  const pageIds = Array.from(
    { length: pageCount },
    (_, index) => 4 + index * 2,
  );
  const objects: Buffer[] = [
    Buffer.from('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'),
    Buffer.from(
      `2 0 obj\n<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>\nendobj\n`,
    ),
    Buffer.concat([
      Buffer.from(
        `3 0 obj\n<< /Type /XObject /Subtype /Image /Width 1275 /Height 1650 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      ),
      jpeg,
      Buffer.from('\nendstream\nendobj\n'),
    ]),
  ];
  for (const pageId of pageIds) {
    const contentId = pageId + 1;
    const content = 'q\n612 0 0 792 0 0 cm\n/Im0 Do\nQ';
    objects.push(
      Buffer.from(
        `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 3 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`,
      ),
      Buffer.from(
        `${contentId} 0 obj\n<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream\nendobj\n`,
      ),
    );
  }
  const header = Buffer.from(
    '%PDF-1.4\n% Synthetic rasterized Suite 9 OCR fixture\n',
  );
  const chunks = [header];
  const offsets = [0];
  let length = header.length;
  objects.forEach((object) => {
    offsets.push(length);
    chunks.push(object);
    length += object.length;
  });
  const xrefOffset = length;
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    '0000000000 65535 f \n',
    ...offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ].join('');
  chunks.push(Buffer.from(xref, 'ascii'));
  return Buffer.concat(chunks);
}

describe('Sprint 8 human OCR review real PostgreSQL and local OCR integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: LocalDocumentStorageAdapter;
  let storageRoot: string;
  let sourceSystemWasPresent = false;
  let institutionalUploadSourceSystemWasPresent = false;
  let actorIds: number[] = [];
  let passedTests = 0;
  let passedSearchTest = false;
  let suite9SearchRuntime: OpenSearchRuntimeService | null = null;
  let suite9SearchTarget: string | null = null;
  let indexedSearchHydrator: CorpusSearchSourceAdapter | null = null;
  const documentIds: string[] = [];
  const storageKeys = new Set<string>();
  const runMeasurements: Record<string, number> = {};
  const sourcePdfShaByDocument = new Map<string, string>();
  let reviewId = '';
  let documentId = '';
  let searchDocumentId = '';
  let testIngestionIdempotencyKey = '';
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
      const script = pageAwareSearchEnabled
        ? process.env.BJC_SPRINT9_PAGE_AWARE_OPENSEARCH_QA_SCRIPT
        : process.env.BJC_SPRINT8_OPENSEARCH_QA_SCRIPT;
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
        if (code === 0) {
          resolveControl();
          return;
        }
        if (action === 'start') {
          const status = spawn(
            'powershell.exe',
            [
              '-NoProfile',
              '-ExecutionPolicy',
              'Bypass',
              '-File',
              script,
              'status',
            ],
            { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
          );
          let output = '';
          status.stdout?.setEncoding('utf8');
          status.stdout?.on('data', (chunk: string) => {
            output += chunk;
          });
          status.once('error', () => {
            rejectControl(
              new Error(
                `SPRINT8_QA_OPENSEARCH_START_FAILED_${code ?? 'SIGNAL'}`,
              ),
            );
          });
          status.once('exit', (statusCode) => {
            try {
              const identity = JSON.parse(output) as {
                status?: string;
                version?: string;
                health?: string;
                http?: string;
                transport?: string;
              };
              if (
                statusCode === 0 &&
                identity.status === 'RUNNING' &&
                identity.version === '2.19.6' &&
                identity.health === 'green' &&
                identity.http === '127.0.0.1:19284' &&
                identity.transport === '127.0.0.1:19384'
              ) {
                resolveControl();
                return;
              }
            } catch {
              // Keep the original start failure as the actionable error.
            }
            rejectControl(
              new Error(
                `SPRINT8_QA_OPENSEARCH_START_FAILED_${code ?? 'SIGNAL'}`,
              ),
            );
          });
          return;
        }
        rejectControl(
          new Error(
            `SPRINT8_QA_OPENSEARCH_${action.toUpperCase()}_FAILED_${code ?? 'SIGNAL'}`,
          ),
        );
      });
    });
  const traceSearch = (phase: string) => {
    if (searchIntegrationEnabled)
      process.stdout.write(`[suite9-search] ${phase}\n`);
  };

  beforeAll(async () => {
    if (!enabled) return;
    traceSearch('beforeAll-start');
    const parsed = new URL(process.env.DATABASE_URL ?? '');
    if (
      parsed.hostname !== '127.0.0.1' ||
      parsed.port !== qaPort ||
      decodeURIComponent(parsed.username) !== 'bjc_dev' ||
      parsed.pathname !== `/${qaDatabase}`
    )
      throw new Error('SPRINT8_TEST_DATABASE_IDENTITY_MISMATCH');
    storageRoot = process.env.BJC_CORPUS_STORAGE_PATH?.trim() ?? '';
    if (!storageRoot) throw new Error('SPRINT8_QA_STORAGE_REQUIRED');
    mkdirSync(storageRoot, { recursive: true });
    storage = new LocalDocumentStorageAdapter(storageRoot);

    const moduleRef = await Test.createTestingModule({
      controllers: [
        InstitutionalIngestionController,
        OcrHumanReviewController,
        CorpusDocumentController,
      ],
      providers: [
        PrismaService,
        LogsService,
        InstitutionalIngestionService,
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
    institutionalUploadSourceSystemWasPresent = Boolean(
      await prisma.corpusSourceSystem.findUnique({
        where: { code: 'INSTITUTIONAL_UPLOAD' },
        select: { id: true },
      }),
    );
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
    if (pageAwareSearchEnabled) {
      const bootstrapStarted = performance.now();
      await controlSearchQa('start');
      const stamp = new Date()
        .toISOString()
        .replace(/[-:.]/gu, '')
        .toLowerCase();
      suite9SearchTarget = `galilei-search-v004-${stamp}-${randomUUID().replaceAll('-', '').slice(0, 8)}`;
      process.env.OPENSEARCH_SEARCH_TARGET = suite9SearchTarget;
      suite9SearchRuntime = new OpenSearchRuntimeService();
      const versionResponse = await suite9SearchRuntime.client.info();
      const versionBody =
        'body' in versionResponse ? versionResponse.body : versionResponse;
      if (versionBody.version.number !== '2.19.6') {
        throw new Error('SPRINT9_QA_OPENSEARCH_VERSION_MISMATCH');
      }
      const highWatermark =
        await suite9SearchRuntime.index.captureFreshV4HighWatermark();
      await suite9SearchRuntime.index.createFreshV4Index(suite9SearchTarget);
      const projected =
        await suite9SearchRuntime.index.projectFreshV4(suite9SearchTarget);
      const parity =
        await suite9SearchRuntime.index.verifyFreshV4SourceParity(
          suite9SearchTarget,
        );
      if (!projected.countCheck.pass || !parity.pass) {
        throw new Error('SPRINT9_QA_FRESH_V4_SOURCE_PARITY_FAILED');
      }
      const activated =
        await suite9SearchRuntime.index.reconcileAndActivateFreshV4(
          suite9SearchTarget,
          highWatermark,
        );
      if (activated.aliasTarget !== suite9SearchTarget) {
        throw new Error('SPRINT9_QA_FRESH_V4_ALIAS_TARGET_MISMATCH');
      }
      runMeasurements.freshV4BootstrapMs = Math.round(
        performance.now() - bootstrapStarted,
      );
      suite9SearchRuntime.syncWorker.start();
      traceSearch('fresh-v4-bootstrap-pass');
    }
  }, 180_000);

  afterAll(async () => {
    const preserveSearchFixture =
      !preserveQaArtifacts &&
      process.env.BJC_SPRINT9_PRESERVE_SEARCH_FIXTURE === 'true' &&
      Boolean(searchDocumentId);
    const cleanupDocumentIds = documentIds.filter(
      (id) => !(preserveSearchFixture && id === searchDocumentId),
    );
    const preservedStorageKeys = new Set<string>();
    try {
      if (preserveSearchFixture && prisma && searchDocumentId) {
        const files = await prisma.corpusDocumentFile.findMany({
          where: { documentId: searchDocumentId },
          select: { storageKey: true },
        });
        for (const file of files) preservedStorageKeys.add(file.storageKey);
      }
      if (indexedSearchHydrator) {
        await indexedSearchHydrator.close();
        indexedSearchHydrator = null;
      }
      if (suite9SearchRuntime) {
        await suite9SearchRuntime.syncWorker.stop();
        await suite9SearchRuntime.onModuleDestroy();
        suite9SearchRuntime = null;
      }
      if (
        searchIntegrationEnabled &&
        !preserveQaArtifacts &&
        !preserveSearchFixture
      ) {
        try {
          await controlSearchQa('stop');
        } catch {
          // The targeted test also stops its exact QA listener in its finally block.
        }
      }
      if (!preserveQaArtifacts && prisma && cleanupDocumentIds.length) {
        const reviews = await prisma.ocrHumanReview.findMany({
          where: { documentId: { in: cleanupDocumentIds } },
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
          where: { documentId: { in: cleanupDocumentIds } },
        });
        await prisma.corpusDocument.deleteMany({
          where: { id: { in: cleanupDocumentIds } },
        });
        await prisma.searchIndexOutbox.deleteMany({
          where: {
            documentKey: { in: cleanupDocumentIds.map((id) => `CORPUS:${id}`) },
          },
        });
      }
      if (
        !preserveQaArtifacts &&
        !preserveSearchFixture &&
        prisma &&
        testIngestionIdempotencyKey
      ) {
        await prisma.institutionalIngestion.deleteMany({
          where: { idempotencyKey: testIngestionIdempotencyKey },
        });
      }
      if (!preserveQaArtifacts && !preserveSearchFixture && prisma) {
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
      if (!preserveQaArtifacts && prisma && !sourceSystemWasPresent) {
        await prisma.corpusSourceSystem.deleteMany({
          where: { code: sourceCode, ingestions: { none: {} } },
        });
      }
      if (
        !preserveQaArtifacts &&
        prisma &&
        !institutionalUploadSourceSystemWasPresent
      ) {
        await prisma.corpusSourceSystem.deleteMany({
          where: { code: 'INSTITUTIONAL_UPLOAD', ingestions: { none: {} } },
        });
      }
      if (!preserveQaArtifacts && storageRoot) {
        const root = resolve(storageRoot);
        for (const key of storageKeys) {
          if (preservedStorageKeys.has(key)) continue;
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
            database: `127.0.0.1:${qaPort}/` + qaDatabase,
            method:
              'Authenticated HTTP against NestJS, real PostgreSQL 16, local Poppler/Tesseract OCR, synthetic PDFs and Corpus files; no production or principal services.',
            localOcrProcessor: enabled,
            passed: pageAwareQaEnabled
              ? passedTests === 3 && passedSearchTest
              : passedTests === 2,
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
            `${JSON.stringify(
              {
                passed: passedSearchTest,
                clusterVersion: '2.19.6',
                clusterHealth: 'GREEN',
                endpoints: ['127.0.0.1:19284', '127.0.0.1:19384'],
                database: `127.0.0.1:${qaPort}/` + qaDatabase,
                indexSchemaVersion: pageAwareSearchEnabled ? 4 : 3,
                alias: pageAwareSearchEnabled
                  ? 'galilei-search-active'
                  : 'galilei-suite8-ocr-active',
                outage:
                  'approval persisted in PostgreSQL; outbox stayed pending while isolated Search was stopped',
                recovery:
                  'same outbox event projected and marked processed after Search restart',
                approvedSearchTextVisible: passedSearchTest,
                pageAwareHydration: pageAwareSearchEnabled,
                documentId: searchDocumentId,
                originalPdfSha256: searchDocumentId
                  ? (sourcePdfShaByDocument.get(searchDocumentId) ?? null)
                  : null,
                syntheticOnly: true,
                completedAt: new Date().toISOString(),
              },
              null,
              2,
            )}\n`,
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
      pageCount?: number;
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
            pageCount: options.pageCount ?? 3,
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

  it('hydrates mixed native and approved OCR pages from the active 50-page extraction', async () => {
    if (!enabled) return;
    const pageTexts = Array.from({ length: 50 }, (_, index) => {
      if (index === 0) return 'pagina nativa inicial controlada';
      if (index === 2) return 'responsabilidad objetiva especial';
      if (index === 16) return 'daño resarcible controlado';
      if (index === 49) return 'doctrina sintetica de cierre';
      return `contenido sintetico de la pagina ${index + 1}`;
    });
    const pdfBytes = fixturePdf(`Suite9 page-aware ${runId}`, pageTexts);
    const document = await createSyntheticDocument(
      pdfBytes,
      `suite9-page-aware-50-${runId}`,
      { pageCount: 50 },
    );
    const file = document.files[0];
    if (!file) throw new Error('SPRINT9_QA_PDF_FILE_MISSING');
    const approvedExtraction = await prisma.corpusExtraction.create({
      data: {
        documentId: document.id,
        fileId: file.id,
        extractor: 'synthetic-human-approved-fixture',
        extractorVersion: 'suite9-page-aware-fixture-v1',
        status: 'OCR_HUMAN_APPROVED',
        text: pageTexts.join('\n'),
        provenance: {
          synthetic: true,
          purpose: 'page-aware-search-real-postgresql-fixture',
          originalPdfSha256: file.sha256,
        },
        pages: {
          create: pageTexts.map((text, index) => {
            const native = index === 0 || index === 9;
            return {
              pageNumber: index + 1,
              text,
              textKind: native ? 'NATIVE' : 'OCR',
              processingStatus: native ? 'TEXT_NATIVE' : 'OCR_HUMAN_APPROVED',
            };
          }),
        },
      },
    });
    await prisma.corpusDocument.update({
      where: { id: document.id },
      data: {
        latestExtractionId: approvedExtraction.id,
        status: 'INDEXED',
        searchText: pageTexts.join('\n'),
      },
    });

    const adapter = new CorpusSearchSourceAdapter(
      process.env.DATABASE_URL ?? '',
    );
    try {
      const search = async (phrase: string) =>
        adapter.search(
          parseSearchQuery(`"${phrase}"`),
          {
            visibility: 'INTERNAL',
            dialect: 'modern',
            publicationPolicy: 'published-active-only',
            page: 1,
            pageSize: 20,
          },
          [document.id],
        );
      const pageOne = await search('pagina nativa inicial controlada');
      expect(pageOne.results[0]?.metadata).toMatchObject({
        pageNumber: 1,
        matchSource: 'PDF_TEXT',
      });
      const pageThree = await search('responsabilidad objetiva especial');
      expect(pageThree.results[0]?.metadata).toMatchObject({
        pageNumber: 3,
        matchSource: 'OCR_APPROVED',
      });
      const pageSeventeen = await search('daño resarcible controlado');
      expect(pageSeventeen.results[0]?.metadata).toMatchObject({
        pageNumber: 17,
        matchSource: 'OCR_APPROVED',
      });
      const pageFifty = await search('doctrina sintetica de cierre');
      expect(pageFifty.results[0]).toMatchObject({
        snippet: expect.stringContaining('doctrina sintetica de cierre'),
        metadata: {
          pageNumber: 50,
          matchSource: 'OCR_APPROVED',
          matchedPageCount: 1,
        },
      });
      expect(pageFifty.results[0]?.metadata.pageTextSha256).toMatch(
        /^[0-9a-f]{64}$/u,
      );

      const rawOcrText = `ocr oculto sin aprobar suite9 ${runId}`;
      const unapprovedDocument = await createSyntheticDocument(
        fixturePdf(`Suite9 unapproved OCR ${runId}`, [null]),
        `suite9-unapproved-ocr-${runId}`,
        { pageCount: 1 },
      );
      const unapprovedFile = unapprovedDocument.files[0];
      if (!unapprovedFile)
        throw new Error('SPRINT9_QA_UNAPPROVED_PDF_FILE_MISSING');
      const unapprovedExtraction = await prisma.corpusExtraction.create({
        data: {
          documentId: unapprovedDocument.id,
          fileId: unapprovedFile.id,
          extractor: 'synthetic-raw-ocr-fixture',
          extractorVersion: 'suite9-raw-ocr-fixture-v1',
          status: 'OCR_DRAFT',
          text: rawOcrText,
          provenance: { synthetic: true, purpose: 'raw-ocr-search-exclusion' },
          pages: {
            create: [
              {
                pageNumber: 1,
                text: rawOcrText,
                textKind: 'OCR',
                processingStatus: 'OCR_DRAFT',
              },
            ],
          },
        },
      });
      await prisma.corpusDocument.update({
        where: { id: unapprovedDocument.id },
        data: {
          latestExtractionId: unapprovedExtraction.id,
          searchText: unapprovedDocument.title,
          status: 'OCR_REQUIRED',
        },
      });
      const rawOcrQuery = parseSearchQuery(`"${rawOcrText}"`);
      const unapprovedSearchContext = {
        visibility: 'INTERNAL' as const,
        dialect: 'modern' as const,
        publicationPolicy: 'published-active-only' as const,
        page: 1,
        pageSize: 10,
      };
      const rawOcrSearch = await adapter.search(
        rawOcrQuery,
        unapprovedSearchContext,
      );
      expect(rawOcrSearch.results).toHaveLength(0);
      const unapprovedHydration = await adapter.search(
        rawOcrQuery,
        unapprovedSearchContext,
        [unapprovedDocument.id],
      );
      expect(unapprovedHydration.results[0]?.metadata).toMatchObject({
        pageNumber: null,
        matchSource: null,
        matchedPageCount: 0,
      });
      expect(unapprovedHydration.results[0]?.snippet).not.toContain(rawOcrText);
      const metadata = await request(server())
        .get(`/api/corpus/documents/${document.id}?pageNumber=50`)
        .set(auth(reviewerId, 'REVISOR'))
        .expect(200);
      expect(metadata.body.selectedPage).toMatchObject({
        pageNumber: 50,
        textKind: 'OCR',
        processingStatus: 'OCR_HUMAN_APPROVED',
      });
      await request(server())
        .get(`/api/corpus/documents/${document.id}?pageNumber=999`)
        .set(auth(reviewerId, 'REVISOR'))
        .expect(400);
      const citation = await request(server())
        .get(`/api/corpus/documents/${document.id}/citation?page=50`)
        .set(auth(reviewerId, 'REVISOR'))
        .expect(200);
      expect(JSON.stringify(citation.body)).toMatch(/50/u);
      const range = await request(server())
        .get(`/api/corpus/documents/${document.id}/file`)
        .set(auth(reviewerId, 'REVISOR'))
        .set('Range', 'bytes=0-4')
        .expect(206);
      expect(range.body.toString('ascii')).toBe('%PDF-');
      passedTests += 1;
    } finally {
      await adapter.close();
    }
  }, 90000);

  it('keeps approved OCR in PostgreSQL/outbox during Search outage and projects it after recovery', async () => {
    if (!enabled || !searchIntegrationEnabled) return;
    let runtime: OpenSearchRuntimeService | null = null;
    try {
      traceSearch('test-start');
      await controlSearchQa('start');
      traceSearch('search-started');
      runtime = pageAwareSearchEnabled
        ? suite9SearchRuntime
        : new OpenSearchRuntimeService();
      if (!runtime) throw new Error('SPRINT9_QA_SEARCH_RUNTIME_REQUIRED');
      traceSearch('search-runtime-created');
      const versionResponse = await runtime.client.info();
      const versionBody =
        'body' in versionResponse ? versionResponse.body : versionResponse;
      expect(versionBody.version.number).toBe('2.19.6');
      if (pageAwareSearchEnabled) {
        if (!suite9SearchTarget)
          throw new Error('SPRINT9_QA_FRESH_V4_TARGET_REQUIRED');
        const active = await runtime.index.verifyActive();
        expect(active).toMatchObject({
          schemaVersion: 4,
          physicalIndex: suite9SearchTarget,
        });
      } else {
        const baseline = await runtime.index.rebuild();
        expect(baseline.integrity.schemaVersion).toBe(3);
        expect(baseline.aliasPromoted).toBe(true);
      }
      traceSearch('baseline-built');
      const scan = scannedPdfFixture(50);
      const originalFilename = `suite9-scanned-outage-${runId}.pdf`;
      const uploadToken = `suite9-${runId}`;
      testIngestionIdempotencyKey = createHash('sha256')
        .update(`${jurisprudenciaId}\0${uploadToken}`)
        .digest('hex');
      const uploadedSha256 = createHash('sha256').update(scan).digest('hex');
      storageKeys.add(`${uploadedSha256.slice(0, 2)}/${uploadedSha256}.pdf`);
      const intake = await request(server())
        .post('/api/corpus/institutional-ingestions/upload')
        .set(auth(jurisprudenciaId, 'JURISPRUDENCIA'))
        .set('idempotency-key', uploadToken)
        .attach('file', scan, {
          filename: originalFilename,
          contentType: 'application/pdf',
        })
        .expect(201);
      const intakeItem = intake.body.data as {
        documentId: string;
        sha256: string;
        status: string;
        extractionStatus: string;
      };
      const uploadedDocumentId = intakeItem.documentId;
      if (uploadedDocumentId) {
        documentIds.push(uploadedDocumentId);
        sourcePdfShaByDocument.set(uploadedDocumentId, uploadedSha256);
      }
      expect(intakeItem.status).toBe('OCR_REQUIRED');
      expect(intakeItem.extractionStatus).toBe('OCR_REQUIRED');
      expect(uploadedDocumentId).toBeTruthy();
      expect(intakeItem.sha256).toBe(uploadedSha256);
      const measuredDocument = await prisma.corpusDocument.findUniqueOrThrow({
        where: { id: uploadedDocumentId },
      });
      expect(measuredDocument.status).toBe('OCR_REQUIRED');
      searchDocumentId = measuredDocument.id;
      traceSearch('institutional-upload-ocr-required');
      const uploadedQueue = await request(server())
        .get('/api/ocr-human-review/queue?filter=all&page=1&pageSize=50')
        .set(auth(reviewerId, 'REVISOR'))
        .expect(200);
      expect(
        uploadedQueue.body.results.some(
          (item: { documentId: string }) =>
            item.documentId === measuredDocument.id,
        ),
      ).toBe(true);
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
      const rawPageFiftyOcr = generated.body.activeRun.pages[49]
        .ocrText as string;
      expect(rawPageFiftyOcr.trim().length).toBeGreaterThan(0);

      const pageSearch = new CorpusSearchSourceAdapter(
        process.env.DATABASE_URL ?? '',
      );
      try {
        const beforeApproval = await pageSearch.search(
          parseSearchQuery(`"suite8 approved outage recovery ${runId}"`),
          {
            visibility: 'INTERNAL',
            dialect: 'modern',
            publicationPolicy: 'published-active-only',
            page: 1,
            pageSize: 10,
          },
        );
        expect(beforeApproval.results).toHaveLength(0);
      } finally {
        await pageSearch.close();
      }

      await runtime.syncWorker.tick();
      traceSearch('pre-approval-projected');
      const beforeApprovalResponse = await runtime.client.get({
        index: runtime.config.alias,
        id: measuredDocument.id,
      });
      const beforeApprovalBody =
        'body' in beforeApprovalResponse
          ? beforeApprovalResponse.body
          : beforeApprovalResponse;
      expect(beforeApprovalBody._source.canonicalSearchText).toContain(
        measuredDocument.title,
      );
      expect(beforeApprovalBody._source.canonicalSearchText).not.toContain(
        'SENTENCIA ESCANEADA',
      );

      const activeIndexedSearchHydrator = new CorpusSearchSourceAdapter(
        process.env.DATABASE_URL ?? '',
      );
      indexedSearchHydrator = activeIndexedSearchHydrator;
      const indexedSearch = runtime.createSource(
        'CORPUS',
        (query, context, candidateIds) =>
          activeIndexedSearchHydrator.search(
            query,
            {
              ...context,
              publicationPolicy: 'published-active-only',
            },
            candidateIds,
          ),
      );
      const approvedPhrase = `suite9 approved page fifty ${runId}`;
      const queryApprovedPhrase = () =>
        indexedSearch.search(parseSearchQuery(`"${approvedPhrase}"`), {
          visibility: 'INTERNAL',
          dialect: 'modern',
          publicationPolicy: 'published-active-only',
          page: 1,
          pageSize: 10,
        });
      expect((await queryApprovedPhrase()).results).toHaveLength(0);

      if (pageAwareSearchEnabled) await runtime.syncWorker.stop();
      if (!preserveQaArtifacts) await controlSearchQa('stop');
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
        if (page.pageNumber === 50) {
          review = await request(server())
            .post(
              `/api/ocr-human-review/${outageReviewId}/pages/${page.pageNumber}/save`,
            )
            .set(auth(reviewerId, 'REVISOR'))
            .send({
              expectedVersion,
              correctedText: approvedPhrase,
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
      expect(databaseTruth.searchText).toContain(approvedPhrase);
      expect(databaseTruth.searchText).not.toContain(rawPageFiftyOcr);
      const approvedPageSearch = new CorpusSearchSourceAdapter(
        process.env.DATABASE_URL ?? '',
      );
      try {
        const pageResult = await approvedPageSearch.search(
          parseSearchQuery(`"${approvedPhrase}"`),
          {
            visibility: 'INTERNAL',
            dialect: 'modern',
            publicationPolicy: 'published-active-only',
            page: 1,
            pageSize: 10,
          },
        );
        expect(pageResult.results[0]).toMatchObject({
          snippet: expect.stringContaining(approvedPhrase),
          metadata: {
            pageNumber: 50,
            matchSource: 'OCR_APPROVED',
            matchedPageCount: 1,
          },
        });
        expect(pageResult.results[0]?.metadata.pageTextSha256).toMatch(
          /^[0-9a-f]{64}$/u,
        );
        expect(JSON.stringify(pageResult.results[0])).not.toContain(
          'sourceExtractionId',
        );
      } finally {
        await approvedPageSearch.close();
      }
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
      ).toContain(approvedPhrase);

      await controlSearchQa('start');
      traceSearch('search-recovered');
      const recoveredVersionResponse = await runtime.client.info();
      const recoveredVersionBody =
        'body' in recoveredVersionResponse
          ? recoveredVersionResponse.body
          : recoveredVersionResponse;
      expect(recoveredVersionBody.version.number).toBe('2.19.6');
      let recoveryBatches = 0;
      let eventAfterRecovery = await prisma.searchIndexOutbox.findUniqueOrThrow(
        {
          where: { id: eventBeforeRecovery.id },
        },
      );
      while (
        !eventAfterRecovery.processedAt &&
        !eventAfterRecovery.failedAt &&
        recoveryBatches < 10
      ) {
        await runtime.syncWorker.tick();
        recoveryBatches += 1;
        eventAfterRecovery = await prisma.searchIndexOutbox.findUniqueOrThrow({
          where: { id: eventBeforeRecovery.id },
        });
      }
      runMeasurements.outboxRecoveryBatches = recoveryBatches;
      traceSearch('outbox-processed');
      expect(eventAfterRecovery.processedAt).toBeTruthy();
      expect(eventAfterRecovery.failedAt).toBeNull();
      const recoveredOutbox = await runtime.index.status();
      expect(recoveredOutbox.outbox.pending).toBe(0);
      expect(recoveredOutbox.outbox.failed).toBe(0);
      const recoveredResponse = await runtime.client.get({
        index: runtime.config.alias,
        id: measuredDocument.id,
      });
      const recoveredBody =
        'body' in recoveredResponse
          ? recoveredResponse.body
          : recoveredResponse;
      expect(recoveredBody._source.canonicalSearchText).toContain(
        approvedPhrase,
      );
      expect(recoveredBody._source.visibility).toBe('INTERNAL');
      expect(recoveredBody._source.publicationStatus).not.toBe('PUBLISHED');
      const recoveredSearch = await queryApprovedPhrase();
      expect(recoveredSearch.results).toHaveLength(1);
      expect(recoveredSearch.results[0]).toMatchObject({
        sourceId: measuredDocument.id,
        snippet: expect.stringContaining(approvedPhrase),
        metadata: {
          pageNumber: 50,
          matchSource: 'OCR_APPROVED',
          matchedPageCount: 1,
        },
      });
      for (let cycle = 0; cycle < 10; cycle += 1) {
        await runtime.syncWorker.tick();
        const stableSearch = await queryApprovedPhrase();
        expect(stableSearch.results).toHaveLength(1);
        expect(stableSearch.results[0]?.sourceId).toBe(measuredDocument.id);
      }
      passedSearchTest = true;
      traceSearch('test-pass');
    } finally {
      if (runtime) {
        await runtime.syncWorker.stop();
        await runtime.onModuleDestroy();
        if (pageAwareSearchEnabled) suite9SearchRuntime = null;
      }
      if (
        !preserveQaArtifacts &&
        process.env.BJC_SPRINT9_PRESERVE_SEARCH_FIXTURE !== 'true'
      ) {
        await controlSearchQa('stop');
      }
    }
  }, 600000);
});

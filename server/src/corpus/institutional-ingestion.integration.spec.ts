import { createHash, randomUUID } from 'node:crypto';
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
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { RolesGuard } from '../auth/guards/roles.guard';
import { LogsService } from '../logs/logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { ArchivosService } from '../archivos/archivos.service';
import { PublicArchivosController } from '../archivos/archivos.controller';
import { InstitutionalIngestionController } from './institutional-ingestion.controller';
import { InstitutionalIngestionService } from './institutional-ingestion.service';
import { LocalDocumentStorageAdapter } from './document-storage.adapter';

const enabled = process.env.SPRINT7_INSTITUTIONAL_POSTGRES_TEST === '1';
const runId = randomUUID().replaceAll('-', '').slice(0, 12);

class SyntheticIdentityGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      user?: AuthenticatedUser;
    }>();
    const role = String(request.headers['x-qa-role'] ?? 'LECTOR');
    const id = Number(request.headers['x-qa-user-id'] ?? 0);
    request.user = {
      id,
      email: `suite7-${role.toLowerCase()}@example.invalid`,
      nombre: 'Suite 7',
      apellido: 'QA',
      rol: { id: 1, nombre: role },
    } as AuthenticatedUser;
    return true;
  }
}

type IntakeResponse = {
  data: {
    id: string;
    status: string;
    duplicateDetected: boolean;
    documentId: string | null;
    fileId: string | null;
    matchClassification: string | null;
    linkedSentenciaId: number | null;
    sha256: string;
    failureCode?: string;
    candidates?: Array<{ id: number }>;
  };
};

function fixturePdf(pageCount: number, prefix: string, searchable = true) {
  const objects = new Map<number, string>();
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const pageRefs: string[] = [];
  for (let page = 0; page < pageCount; page += 1) {
    const pageId = 3 + page * 2;
    const contentId = pageId + 1;
    pageRefs.push(`${pageId} 0 R`);
    const text =
      `${prefix} synthetic judgment QA page ${page + 1} with searchable legal text.`
        .replaceAll('\\', '\\\\')
        .replaceAll('(', '\\(')
        .replaceAll(')', '\\)');
    const stream = searchable
      ? `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`
      : 'q Q';
    objects.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${3 + pageCount * 2} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    objects.set(
      contentId,
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    );
  }
  objects.set(
    2,
    `<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pageCount} >>`,
  );
  objects.set(
    3 + pageCount * 2,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  );
  const maxId = 3 + pageCount * 2;
  const fixtureLabel = prefix.replace(/[\r\n]/g, ' ');
  let output = `%PDF-1.4\n% Synthetic Suite 7 QA fixture ${fixtureLabel}\n`;
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

describe('Sprint 7 institutional PDF intake PostgreSQL integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminId: number;
  let operatorId: number;
  let jurisprudenciaId: number;
  let reviewerId: number;
  let readerId: number;
  let storageRoot: string;
  let sourceSystemExistedBefore = false;
  const createdSentenceIds: number[] = [];
  const performanceMeasures: Record<string, number> = {};
  const performanceBytes: Record<string, number> = {};
  const server = () => app.getHttpServer() as Server;
  const auth = (id: number, role: string) => ({
    'x-qa-user-id': String(id),
    'x-qa-role': role,
  });

  beforeAll(async () => {
    if (!enabled) return;
    storageRoot = process.env.BJC_CORPUS_STORAGE_PATH?.trim() ?? '';
    if (!storageRoot) throw new Error('SPRINT7_QA_STORAGE_REQUIRED');
    mkdirSync(storageRoot, { recursive: true });
    const eventTracker = { trackSafe: () => undefined };
    const moduleRef = await Test.createTestingModule({
      controllers: [InstitutionalIngestionController, PublicArchivosController],
      providers: [
        PrismaService,
        LogsService,
        InstitutionalIngestionService,
        { provide: APP_GUARD, useClass: SyntheticIdentityGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        {
          provide: ArchivosService,
          inject: [PrismaService, LogsService],
          useFactory: (client: PrismaService, logs: LogsService) =>
            new ArchivosService(client, eventTracker as never, logs),
        },
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
    sourceSystemExistedBefore = Boolean(
      await prisma.corpusSourceSystem.findUnique({
        where: { code: 'INSTITUTIONAL_UPLOAD' },
        select: { id: true },
      }),
    );

    const roleIds = new Map<string, number>();
    for (const name of [
      'ADMIN',
      'OPERADOR',
      'JURISPRUDENCIA',
      'REVISOR',
      'LECTOR',
    ]) {
      const role = await prisma.rol.upsert({
        where: { nombre: name },
        create: { nombre: name, descripcion: 'Synthetic Suite 7 QA role' },
        update: {},
      });
      roleIds.set(name, role.id);
    }
    const account = async (role: string) =>
      prisma.usuario.create({
        data: {
          nombre: 'Suite 7 QA',
          email: `suite7-${role.toLowerCase()}-${runId}@example.invalid`,
          passwordHash: 'synthetic-only-not-authenticated',
          rolId: roleIds.get(role)!,
        },
      });
    adminId = (await account('ADMIN')).id;
    operatorId = (await account('OPERADOR')).id;
    jurisprudenciaId = (await account('JURISPRUDENCIA')).id;
    reviewerId = (await account('REVISOR')).id;
    readerId = (await account('LECTOR')).id;
  }, 30000);

  afterAll(async () => {
    try {
      console.log(
        `[SPRINT7_INTEGRATION_CLEANUP] enabled=${enabled} actors=${[adminId, operatorId, jurisprudenciaId, reviewerId, readerId].filter(Boolean).length}`,
      );
      if (
        prisma &&
        adminId &&
        operatorId &&
        jurisprudenciaId &&
        reviewerId &&
        readerId
      ) {
        const actorIds = [
          adminId,
          operatorId,
          jurisprudenciaId,
          reviewerId,
          readerId,
        ];
        const intakes = await prisma.institutionalIngestion.findMany({
          where: { createdById: { in: actorIds } },
          select: { id: true, documentId: true },
        });
        const intakeIds = intakes.map(({ id }) => id);
        const documentIds = [
          ...new Set(
            intakes
              .map(({ documentId }) => documentId)
              .filter((id): id is string => Boolean(id)),
          ),
        ];
        const candidateDocuments = documentIds.length
          ? await prisma.corpusDocument.findMany({
              where: { id: { in: documentIds } },
              select: { id: true, metadataOriginal: true },
            })
          : [];
        const intakeIdSet = new Set(intakeIds);
        const ownedDocumentIds = candidateDocuments
          .filter((document) => {
            const metadata = document.metadataOriginal;
            return (
              metadata !== null &&
              typeof metadata === 'object' &&
              !Array.isArray(metadata) &&
              typeof metadata.institutionalIngestionId === 'string' &&
              intakeIdSet.has(metadata.institutionalIngestionId)
            );
          })
          .map(({ id }) => id);
        const storageFiles = ownedDocumentIds.length
          ? await prisma.corpusDocumentFile.findMany({
              where: { documentId: { in: ownedDocumentIds } },
              select: { storageKey: true },
            })
          : [];

        if (intakeIds.length) {
          await prisma.institutionalIngestion.deleteMany({
            where: { id: { in: intakeIds } },
          });
        }
        if (createdSentenceIds.length) {
          await prisma.sentencia.deleteMany({
            where: { id: { in: createdSentenceIds } },
          });
        }
        if (ownedDocumentIds.length) {
          await prisma.corpusDocument.deleteMany({
            where: { id: { in: ownedDocumentIds } },
          });
        }

        for (const { storageKey } of storageFiles) {
          const target = resolve(storageRoot, ...storageKey.split('/'));
          const root = resolve(storageRoot);
          if (!target.startsWith(`${root}${sep}`)) {
            throw new Error('SPRINT7_CLEANUP_STORAGE_ESCAPE');
          }
          const remainingReferences = await prisma.corpusDocumentFile.count({
            where: { storageKey },
          });
          if (remainingReferences === 0) {
            try {
              await unlink(target);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                throw error;
            }
          }
        }
        await prisma.usuario.deleteMany({ where: { id: { in: actorIds } } });
        if (!sourceSystemExistedBefore) {
          await prisma.corpusSourceSystem.deleteMany({
            where: {
              code: 'INSTITUTIONAL_UPLOAD',
              ingestions: { none: {} },
            },
          });
        }
        if (Object.keys(performanceMeasures).length > 0) {
          const configuredEnvFile = process.env.BJC_DEV_DB_GUARD_ENV_FILE;
          if (configuredEnvFile) {
            const evidenceRoot = resolve(configuredEnvFile, '..', 'evidence');
            writeFileSync(
              resolve(evidenceRoot, 'performance.json'),
              `${JSON.stringify(
                {
                  method:
                    'Local wall-clock time around authenticated HTTP upload requests; includes multipart transfer, validation, SHA-256, deduplication, canonical storage, extraction, and API response. Fixture generation and user metadata-review time are excluded. Internal per-stage timings are not exposed by the production service.',
                  maximumUploadBytes: 100 * 1024 * 1024,
                  measurementsMs: performanceMeasures,
                  inputBytes: performanceBytes,
                  measuredAt: new Date().toISOString(),
                },
                null,
                2,
              )}\n`,
              'utf8',
            );
          }
        }
        const [remainingIntakes, remainingUsers] = await Promise.all([
          prisma.institutionalIngestion.count({
            where: { createdById: { in: actorIds } },
          }),
          prisma.usuario.count({ where: { id: { in: actorIds } } }),
        ]);
        if (remainingIntakes !== 0 || remainingUsers !== 0) {
          throw new Error('SPRINT7_INTEGRATION_CLEANUP_INCOMPLETE');
        }
      }
    } finally {
      if (app) await app.close();
    }
  });

  it('validates and stores one searchable PDF, then deduplicates exact bytes across names', async () => {
    if (!enabled) return;
    const bytes = fixturePdf(3, `Suite7 ${runId} flow1`);
    const smallStarted = performance.now();
    const uploaded = await request(server())
      .post('/api/corpus/institutional-ingestions/upload')
      .set(auth(operatorId, 'OPERADOR'))
      .set('Idempotency-Key', `upload-${runId}-one`)
      .attach('file', bytes, {
        filename: `decision-${runId}.pdf`,
        contentType: 'application/pdf',
      })
      .expect(201);
    performanceMeasures['3-page-upload'] = Number(
      (performance.now() - smallStarted).toFixed(2),
    );
    performanceBytes['3-page-upload'] = bytes.byteLength;
    const first = (uploaded.body as IntakeResponse).data;
    expect(first.status).toBe('METADATA_PENDING');
    expect(first.documentId).toBeTruthy();
    expect(first.fileId).toBeTruthy();
    const corpusFileCount = await prisma.corpusDocumentFile.count({
      where: { sha256: first.sha256 },
    });
    expect(corpusFileCount).toBe(1);
    const corpus = await prisma.corpusDocument.findUniqueOrThrow({
      where: { id: first.documentId! },
      include: { files: true, latestExtraction: { include: { pages: true } } },
    });
    expect(corpus.visibility).toBe('INTERNAL');
    expect(corpus.documentScope).toBe('GENERAL');
    expect(corpus.latestExtraction?.pages).toHaveLength(3);
    const storedBytes = await new LocalDocumentStorageAdapter(storageRoot).get(
      corpus.files[0].storageKey,
    );
    expect(createHash('sha256').update(storedBytes).digest('hex')).toBe(
      first.sha256,
    );

    const fiftyPageBytes = fixturePdf(50, `Suite7 ${runId} flow50`);
    const fiftyStarted = performance.now();
    const largePdf = await request(server())
      .post('/api/corpus/institutional-ingestions/upload')
      .set(auth(operatorId, 'OPERADOR'))
      .set('Idempotency-Key', `upload-${runId}-fifty-pages`)
      .attach('file', fiftyPageBytes, {
        filename: `fifty-${runId}.pdf`,
        contentType: 'application/pdf',
      })
      .expect(201);
    performanceMeasures['50-page-upload'] = Number(
      (performance.now() - fiftyStarted).toFixed(2),
    );
    performanceBytes['50-page-upload'] = fiftyPageBytes.byteLength;
    const largeItem = (largePdf.body as IntakeResponse).data;
    const largeDocument = await prisma.corpusDocument.findUniqueOrThrow({
      where: { id: largeItem.documentId! },
      include: { latestExtraction: { include: { pages: true } } },
    });
    expect(largeDocument.latestExtraction?.pages).toHaveLength(50);

    const duplicateStarted = performance.now();
    const duplicate = await request(server())
      .post('/api/corpus/institutional-ingestions/upload')
      .set(auth(jurisprudenciaId, 'JURISPRUDENCIA'))
      .set('Idempotency-Key', `upload-${runId}-duplicate`)
      .attach('file', bytes, {
        filename: `renamed-${runId}.pdf`,
        contentType: 'application/pdf',
      })
      .expect(201);
    performanceMeasures['exact-duplicate-upload'] = Number(
      (performance.now() - duplicateStarted).toFixed(2),
    );
    performanceBytes['exact-duplicate-upload'] = bytes.byteLength;
    const second = (duplicate.body as IntakeResponse).data;
    expect(second.duplicateDetected).toBe(true);
    expect(second.documentId).toBe(first.documentId);
    expect(second.fileId).toBe(first.fileId);
    expect(
      await prisma.corpusDocumentFile.count({
        where: { sha256: first.sha256 },
      }),
    ).toBe(1);
  }, 60000);

  it('measures a larger permitted PDF below the 100 MiB server limit', async () => {
    if (!enabled) return;
    const basePdf = fixturePdf(1, `Suite7 ${runId} large-file`);
    const paddingBytes = 16 * 1024 * 1024;
    const bytes = Buffer.concat([basePdf, Buffer.alloc(paddingBytes, 0x20)]);
    const started = performance.now();
    const response = await request(server())
      .post('/api/corpus/institutional-ingestions/upload')
      .set(auth(operatorId, 'OPERADOR'))
      .set('Idempotency-Key', `large-permitted-${runId}`)
      .attach('file', bytes, {
        filename: `large-permitted-${runId}.pdf`,
        contentType: 'application/pdf',
      })
      .expect(201);
    performanceMeasures['large-permitted-16-MiB-upload'] = Number(
      (performance.now() - started).toFixed(2),
    );
    performanceBytes['large-permitted-16-MiB-upload'] = bytes.byteLength;
    const item = (response.body as IntakeResponse).data;
    expect(item.status).toBe('METADATA_PENDING');
    expect(item.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    const file = await prisma.corpusDocumentFile.findFirstOrThrow({
      where: { documentId: item.documentId!, sha256: item.sha256 },
      select: { sizeBytes: true, pageCount: true },
    });
    expect(Number(file.sizeBytes)).toBe(bytes.byteLength);
    expect(file.pageCount).toBe(1);
  }, 90000);

  it('does not treat a reused filename with changed bytes as a duplicate', async () => {
    if (!enabled) return;
    const firstBytes = fixturePdf(1, `Filename collision A ${runId}`);
    const secondBytes = fixturePdf(1, `Filename collision B ${runId}`);
    const upload = async (bytes: Buffer, key: string) =>
      request(server())
        .post('/api/corpus/institutional-ingestions/upload')
        .set(auth(operatorId, 'OPERADOR'))
        .set('Idempotency-Key', key)
        .attach('file', bytes, {
          filename: `same-name-${runId}.pdf`,
          contentType: 'application/pdf',
        })
        .expect(201);
    const first = (
      (await upload(firstBytes, `same-name-a-${runId}`)).body as IntakeResponse
    ).data;
    const second = (
      (await upload(secondBytes, `same-name-b-${runId}`)).body as IntakeResponse
    ).data;
    expect(first.sha256).not.toBe(second.sha256);
    expect(second.duplicateDetected).toBe(false);
    expect(second.documentId).not.toBe(first.documentId);
  }, 60000);

  it('stores malformed attempts as failed workflow metadata without creating Corpus files and denies LECTOR', async () => {
    if (!enabled) return;
    const fake = Buffer.from(`not a pdf ${runId}`);
    await request(server())
      .post('/api/corpus/institutional-ingestions/upload')
      .set(auth(operatorId, 'OPERADOR'))
      .set('Idempotency-Key', `malformed-${runId}`)
      .attach('file', fake, {
        filename: `bad-${runId}.pdf`,
        contentType: 'application/pdf',
      })
      .expect(400);
    const sha256 = createHash('sha256').update(fake).digest('hex');
    const failed = await prisma.institutionalIngestion.findFirst({
      where: { sha256, createdById: operatorId },
      orderBy: { createdAt: 'desc' },
    });
    expect(failed?.status).toBe('FAILED');
    expect(await prisma.corpusDocumentFile.count({ where: { sha256 } })).toBe(
      0,
    );

    await request(server())
      .post('/api/corpus/institutional-ingestions/upload')
      .set(auth(readerId, 'LECTOR'))
      .attach('file', fixturePdf(1, `Denied ${runId}`), {
        filename: 'denied.pdf',
        contentType: 'application/pdf',
      })
      .expect(403);
    await request(server())
      .get('/api/corpus/institutional-ingestions')
      .set(auth(readerId, 'LECTOR'))
      .expect(403);
  }, 60000);

  it('enforces ADMIN, REVISOR and LECTOR access on the live workflow routes', async () => {
    if (!enabled) return;
    const uploaded = await request(server())
      .post('/api/corpus/institutional-ingestions/upload')
      .set(auth(adminId, 'ADMIN'))
      .set('Idempotency-Key', `role-matrix-${runId}`)
      .attach('file', fixturePdf(1, `Role matrix ${runId}`), {
        filename: `role-matrix-${runId}.pdf`,
        contentType: 'application/pdf',
      })
      .expect(201);
    const intake = (uploaded.body as IntakeResponse).data;

    await request(server())
      .get('/api/corpus/institutional-ingestions')
      .set(auth(reviewerId, 'REVISOR'))
      .expect(200);
    await request(server())
      .get(`/api/corpus/institutional-ingestions/${intake.id}`)
      .set(auth(reviewerId, 'REVISOR'))
      .expect(200);
    await request(server())
      .patch(`/api/corpus/institutional-ingestions/${intake.id}/metadata`)
      .set(auth(reviewerId, 'REVISOR'))
      .send({
        expediente: 'QA',
        sala: 'QA',
        fecha: '2026-10-26',
        caratula: 'QA',
      })
      .expect(403);

    const confirmed = await request(server())
      .patch(`/api/corpus/institutional-ingestions/${intake.id}/metadata`)
      .set(auth(adminId, 'ADMIN'))
      .send({
        expediente: `ROLE ${runId}/2026`,
        sala: `Sala Role ${runId}`,
        fecha: '2026-10-26',
        caratula: `Role matrix ${runId}`,
      })
      .expect(200);
    expect((confirmed.body as IntakeResponse).data.status).toBe(
      'READY_TO_CREATE_DRAFT',
    );

    await request(server())
      .get(`/api/corpus/institutional-ingestions/${intake.id}`)
      .set(auth(readerId, 'LECTOR'))
      .expect(403);
  }, 60000);

  it('confirms metadata, links a unique exact match, and preserves publication state', async () => {
    if (!enabled) return;
    const date = new Date('2026-10-26T00:00:00.000Z');
    const sentence = await prisma.sentencia.create({
      data: {
        expediente: `QA ${runId}/2026`,
        sala: `Sala QA ${runId}`,
        fecha: date,
        caratula: `Synthetic existing ${runId}`,
        publicado: true,
        publishedAt: date,
        estadoCarga: 'PUBLICADA',
        activo: true,
      },
    });
    createdSentenceIds.push(sentence.id);
    const uploaded = await request(server())
      .post('/api/corpus/institutional-ingestions/upload')
      .set(auth(operatorId, 'OPERADOR'))
      .set('Idempotency-Key', `match-${runId}`)
      .attach('file', fixturePdf(2, `Unique match ${runId}`), {
        filename: `match-${runId}.pdf`,
        contentType: 'application/pdf',
      })
      .expect(201);
    const intake = (uploaded.body as IntakeResponse).data;
    const metadata = {
      expediente: `QA ${runId}/2026`,
      sala: `Sala QA ${runId}`,
      fecha: '2026-10-26',
      caratula: `Synthetic existing ${runId}`,
    };
    const confirmed = await request(server())
      .patch(`/api/corpus/institutional-ingestions/${intake.id}/metadata`)
      .set(auth(operatorId, 'OPERADOR'))
      .send(metadata)
      .expect(200);
    expect((confirmed.body as IntakeResponse).data.status).toBe(
      'MATCH_CANDIDATE',
    );
    const linked = await request(server())
      .post(`/api/corpus/institutional-ingestions/${intake.id}/link`)
      .set(auth(operatorId, 'OPERADOR'))
      .send({ sentenciaId: String(sentence.id) })
      .expect(201);
    expect((linked.body as IntakeResponse).data.status).toBe('LINKED');
    await request(server())
      .post(`/api/corpus/institutional-ingestions/${intake.id}/link`)
      .set(auth(operatorId, 'OPERADOR'))
      .send({ sentenciaId: String(sentence.id) })
      .expect(201);
    const unchanged = await prisma.sentencia.findUniqueOrThrow({
      where: { id: sentence.id },
    });
    expect(unchanged.publicado).toBe(true);
    expect(unchanged.publishedAt?.toISOString()).toBe(date.toISOString());
    expect(unchanged.estadoCarga).toBe('PUBLICADA');
    expect(
      await prisma.archivoPdf.count({ where: { sentenciaId: sentence.id } }),
    ).toBe(1);
    expect(
      await prisma.corpusDocumentLink.count({
        where: {
          documentId: intake.documentId!,
          targetId: String(sentence.id),
          targetDomain: 'JURISPRUDENCIA',
        },
      }),
    ).toBe(1);
  }, 60000);

  it('serializes links from duplicate intake attempts so one canonical PDF cannot attach to two sentences', async () => {
    if (!enabled) return;
    const date = new Date('2026-10-26T00:00:00.000Z');
    const expediente = `LINK-RACE ${runId}/2026`;
    const sala = `Sala Link Race ${runId}`;
    const sentences = await Promise.all(
      [1, 2].map((index) =>
        prisma.sentencia.create({
          data: {
            expediente,
            sala,
            fecha: date,
            caratula: `Link race candidate ${index} ${runId}`,
            publicado: false,
            estadoCarga: 'BORRADOR',
          },
        }),
      ),
    );
    createdSentenceIds.push(...sentences.map(({ id }) => id));

    const bytes = fixturePdf(1, `Link race ${runId}`);
    const upload = async (key: string, filename: string) =>
      request(server())
        .post('/api/corpus/institutional-ingestions/upload')
        .set(auth(operatorId, 'OPERADOR'))
        .set('Idempotency-Key', key)
        .attach('file', bytes, { filename, contentType: 'application/pdf' })
        .expect(201);
    const intakes = await Promise.all([
      upload(`link-race-a-${runId}`, `link-race-a-${runId}.pdf`),
      upload(`link-race-b-${runId}`, `link-race-b-${runId}.pdf`),
    ]);
    const items = intakes.map(
      (response) => (response.body as IntakeResponse).data,
    );
    // Promise.all preserves input order, but it does not determine which HTTP
    // request wins the database lock. Exactly one request must reuse the first
    // canonical document regardless of which client arrival wins.
    expect(items.map((item) => item.duplicateDetected).sort()).toEqual([
      false,
      true,
    ]);
    expect(items[0].documentId).toBe(items[1].documentId);

    const metadata = {
      expediente,
      sala,
      fecha: '2026-10-26',
      caratula: `Link race ${runId}`,
    };
    await Promise.all(
      items.map((item) =>
        request(server())
          .patch(`/api/corpus/institutional-ingestions/${item.id}/metadata`)
          .set(auth(operatorId, 'OPERADOR'))
          .send(metadata)
          .expect(200),
      ),
    );

    const attempts = await Promise.all(
      items.map((item, index) =>
        request(server())
          .post(`/api/corpus/institutional-ingestions/${item.id}/link`)
          .set(auth(operatorId, 'OPERADOR'))
          .send({ sentenciaId: String(sentences[index].id) }),
      ),
    );
    expect(attempts.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(
      await prisma.corpusDocumentLink.count({
        where: {
          documentId: items[0].documentId!,
          targetDomain: 'JURISPRUDENCIA',
          targetType: 'SENTENCIA',
        },
      }),
    ).toBe(1);
    expect(
      await prisma.archivoPdf.count({
        where: { sentenciaId: { in: sentences.map(({ id }) => id) } },
      }),
    ).toBe(1);
  }, 90000);

  it('requires human choice for multiple matches, then creates a private unpublished draft only after explicit action', async () => {
    if (!enabled) return;
    const date = new Date('2026-10-26T00:00:00.000Z');
    const expediente = `AMB ${runId}/2026`;
    const sala = `Sala Ambigua ${runId}`;
    const exactCandidates = await Promise.all(
      [1, 2].map((index) =>
        prisma.sentencia.create({
          data: {
            expediente,
            sala,
            fecha: date,
            caratula: `Ambiguous QA ${index} ${runId}`,
            publicado: false,
            estadoCarga: 'BORRADOR',
          },
        }),
      ),
    );
    createdSentenceIds.push(...exactCandidates.map(({ id }) => id));
    const upload = await request(server())
      .post('/api/corpus/institutional-ingestions/upload')
      .set(auth(operatorId, 'OPERADOR'))
      .set('Idempotency-Key', `ambiguous-${runId}`)
      .attach('file', fixturePdf(1, `Ambiguous ${runId}`), {
        filename: `ambiguous-${runId}.pdf`,
        contentType: 'application/pdf',
      })
      .expect(201);
    const intake = (upload.body as IntakeResponse).data;
    const confirmed = await request(server())
      .patch(`/api/corpus/institutional-ingestions/${intake.id}/metadata`)
      .set(auth(operatorId, 'OPERADOR'))
      .send({
        expediente,
        sala,
        fecha: '2026-10-26',
        caratula: `Ambiguous QA ${runId}`,
      })
      .expect(200);
    const match = (confirmed.body as IntakeResponse).data;
    expect(match.status).toBe('REVIEW_REQUIRED');
    expect(match.matchClassification).toBe('MULTIPLE_EXACT');
    expect(match.candidates).toHaveLength(2);
    await request(server())
      .post(`/api/corpus/institutional-ingestions/${intake.id}/draft`)
      .set(auth(operatorId, 'OPERADOR'))
      .expect(409);

    const draftIntake = await request(server())
      .post('/api/corpus/institutional-ingestions/upload')
      .set(auth(operatorId, 'OPERADOR'))
      .set('Idempotency-Key', `draft-${runId}`)
      .attach('file', fixturePdf(1, `New draft ${runId}`), {
        filename: `draft-${runId}.pdf`,
        contentType: 'application/pdf',
      })
      .expect(201);
    const draftId = (draftIntake.body as IntakeResponse).data.id;
    await request(server())
      .patch(`/api/corpus/institutional-ingestions/${draftId}/metadata`)
      .set(auth(operatorId, 'OPERADOR'))
      .send({
        expediente: `NEW ${runId}/2026`,
        sala: `Sala Nueva ${runId}`,
        fecha: '2026-10-26',
        caratula: `New draft ${runId}`,
      })
      .expect(200);
    const created = await request(server())
      .post(`/api/corpus/institutional-ingestions/${draftId}/draft`)
      .set(auth(operatorId, 'OPERADOR'))
      .expect(201);
    const createdIntake = (created.body as IntakeResponse).data;
    expect(createdIntake.status).toBe('DRAFT_CREATED');
    const repeatedDraft = await request(server())
      .post(`/api/corpus/institutional-ingestions/${draftId}/draft`)
      .set(auth(operatorId, 'OPERADOR'))
      .expect(201);
    expect((repeatedDraft.body as IntakeResponse).data.linkedSentenciaId).toBe(
      createdIntake.linkedSentenciaId,
    );
    const sentence = await prisma.sentencia.findUniqueOrThrow({
      where: { id: createdIntake.linkedSentenciaId! },
      include: { archivosPdf: true },
    });
    createdSentenceIds.push(sentence.id);
    const draftCorpus = await prisma.corpusDocument.findUniqueOrThrow({
      where: { id: createdIntake.documentId! },
      select: { metadataOriginal: true },
    });
    expect(draftCorpus.metadataOriginal).toMatchObject({
      originalFilename: `draft-${runId}.pdf`,
      sha256: createdIntake.sha256,
      institutionalIngestionId: draftId,
      intakeChannel: 'INSTITUTIONAL_UPLOAD',
    });
    expect(sentence.publicado).toBe(false);
    expect(sentence.publishedAt).toBeNull();
    expect(sentence.estadoCarga).toBe('BORRADOR');
    expect(sentence.activo).toBe(true);
    expect(sentence.archivosPdf).toHaveLength(1);
    expect(sentence.fecha?.toISOString().slice(0, 10)).toBe('2026-10-26');
    await request(server())
      .get(`/api/public/sentencias/${sentence.id}/pdf`)
      .expect(404);
    expect(
      (
        await prisma.sentencia.findMany({
          where: {
            id: { in: exactCandidates.map((candidate) => candidate.id) },
          },
        })
      ).length,
    ).toBe(2);
  }, 90000);

  it('returns OCR_REQUIRED for a parseable scan, supports cancellation and idempotent retry', async () => {
    if (!enabled) return;
    const scan = await request(server())
      .post('/api/corpus/institutional-ingestions/upload')
      .set(auth(operatorId, 'OPERADOR'))
      .set('Idempotency-Key', `scan-${runId}`)
      .attach('file', fixturePdf(1, `No text ${runId}`, false), {
        filename: `scan-${runId}.pdf`,
        contentType: 'application/pdf',
      })
      .expect(201);
    const scanItem = (scan.body as IntakeResponse).data;
    expect(scanItem.status).toBe('OCR_REQUIRED');
    const retry = await request(server())
      .post(
        `/api/corpus/institutional-ingestions/${scanItem.id}/retry-extraction`,
      )
      .set(auth(operatorId, 'OPERADOR'))
      .expect(201);
    expect((retry.body as IntakeResponse).data.status).toBe('OCR_REQUIRED');

    const cancelUpload = await request(server())
      .post('/api/corpus/institutional-ingestions/upload')
      .set(auth(operatorId, 'OPERADOR'))
      .set('Idempotency-Key', `cancel-${runId}`)
      .attach('file', fixturePdf(1, `Cancel ${runId}`), {
        filename: `cancel-${runId}.pdf`,
        contentType: 'application/pdf',
      })
      .expect(201);
    const cancelled = await request(server())
      .post(
        `/api/corpus/institutional-ingestions/${(cancelUpload.body as IntakeResponse).data.id}/cancel`,
      )
      .set(auth(operatorId, 'OPERADOR'))
      .expect(201);
    expect((cancelled.body as IntakeResponse).data.status).toBe('CANCELLED');
  }, 90000);

  it('is idempotent for a repeated request key and serializes concurrent identical PDFs', async () => {
    if (!enabled) return;
    const repeatedBytes = fixturePdf(1, `Idempotency ${runId}`);
    const send = (key: string, id: number) =>
      request(server())
        .post('/api/corpus/institutional-ingestions/upload')
        .set(auth(id, id === readerId ? 'LECTOR' : 'OPERADOR'))
        .set('Idempotency-Key', key)
        .attach('file', repeatedBytes, {
          filename: `idem-${runId}.pdf`,
          contentType: 'application/pdf',
        });
    const first = await send(`idem-same-${runId}`, operatorId).expect(201);
    const second = await send(`idem-same-${runId}`, operatorId).expect(201);
    expect((first.body as IntakeResponse).data.id).toBe(
      (second.body as IntakeResponse).data.id,
    );

    const concurrentBytes = fixturePdf(1, `Concurrent ${runId}`);
    const responses = await Promise.all([
      request(server())
        .post('/api/corpus/institutional-ingestions/upload')
        .set(auth(operatorId, 'OPERADOR'))
        .set('Idempotency-Key', `concurrent-a-${runId}`)
        .attach('file', concurrentBytes, {
          filename: `concurrent-a-${runId}.pdf`,
          contentType: 'application/pdf',
        }),
      request(server())
        .post('/api/corpus/institutional-ingestions/upload')
        .set(auth(jurisprudenciaId, 'JURISPRUDENCIA'))
        .set('Idempotency-Key', `concurrent-b-${runId}`)
        .attach('file', concurrentBytes, {
          filename: `concurrent-b-${runId}.pdf`,
          contentType: 'application/pdf',
        }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 201,
    ]);
    const results = responses.map(
      (response) => (response.body as IntakeResponse).data,
    );
    expect(results[0].documentId).toBe(results[1].documentId);
    expect(results[0].fileId).toBe(results[1].fileId);
    expect(
      await prisma.corpusDocumentFile.count({
        where: { sha256: results[0].sha256 },
      }),
    ).toBe(1);
  }, 120000);
});

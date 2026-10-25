import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../app.module';
import { getRuntimeDatabasePoolConfig } from '../config/runtime-database-config';
import { SEARCH_DATABASE_POOL_CONFIG } from '../busqueda/busqueda.module';
import { OpenSearchRuntimeService } from '../busqueda/opensearch/opensearch-runtime.service';
import { PrismaService } from '../prisma/prisma.service';

const enabled = process.env.SPRINT10_POSTGRES_TEST === '1';
type Account = { email: string; password: string };
type Credentials = {
  accounts: Record<
    'admin' | 'operator' | 'reader' | 'reviewer' | 'jurisprudencia' | 'digesto',
    Account
  >;
};
type SearchResponse = {
  federated: {
    total: number;
    results: Array<{ sourceId: string; sourceSystem: string }>;
  };
};
type LoginResponse = { accessToken: string; user: { id: number } };
type AuthMeResponse = { rol: { nombre: string } };
type IdResponse = { id: string };
type MembershipResponse = {
  results: Array<{ documentId: string; status: string }>;
};
type CatalogResponse = Array<{ id: string }>;
type CollectionDetailResponse = { documents: Array<{ id: string }> };
type SumarioResponse = { data: { id: number; tema: string } };
type ReviewQueueResponse = {
  results: Array<{ classifications?: Array<{ id: string }> }>;
};
type StatusResponse = { status: string };
type AuditResponse = { data: unknown[] };
type MatchesResponse = { total: number };
type JurisprudenceDetailResponse = {
  editorialStatus: string;
  metadata: { jurisprudenceCuration: { reason: string } };
  history: Array<{ accion: string }>;
};

const responseBody = <T>(body: unknown): T => body as T;

describe('Sprint 10 authenticated pilot PostgreSQL E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let credentials: Credentials;
  const tokens: Record<string, string> = {};
  const userIds: Record<string, number> = {};
  let documentId = '';
  let associationId = '';
  let classificationId = '';
  let sentenceId = 0;
  let sumarioId = 0;
  let collectionId = '';
  let fixtureCollectionId = '';
  let fixtureSourceId = '';
  let fixtureSourceCreated = false;
  let jurisprudenciaSourceId = '';
  let jurisprudenciaSourceCreated = false;
  let fixtureDocumentId = '';
  let fixtureSearchTerm = '';
  let fixtureFilePath = '';
  let topicId = '';
  let tagId = '';
  const fixtureDocumentIds: string[] = [];
  const actionLogIds: number[] = [];
  const httpServer = (): Server => app.getHttpServer() as Server;

  beforeAll(async () => {
    if (!enabled) return;
    const credentialsPath = process.env.SPRINT10_CREDENTIALS_PATH?.trim();
    credentials = JSON.parse(
      readFileSync(
        credentialsPath ||
          resolve(
            process.cwd(),
            '../_recovery-work/sprint10/acceptance/credentials.json',
          ),
        'utf8',
      ),
    ) as Credentials;
    const databaseConfig = getRuntimeDatabasePoolConfig();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SEARCH_DATABASE_POOL_CONFIG)
      .useValue(databaseConfig)
      .overrideProvider(OpenSearchRuntimeService)
      .useFactory({
        factory: () => new OpenSearchRuntimeService(databaseConfig),
      })
      .compile();
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
    const roleNames = [
      'admin',
      'operator',
      'reader',
      'reviewer',
      'jurisprudencia',
      'digesto',
    ] as const;
    const expectedRoles: Record<(typeof roleNames)[number], string> = {
      admin: 'ADMIN',
      operator: 'OPERADOR',
      reader: 'LECTOR',
      reviewer: 'REVISOR',
      jurisprudencia: 'JURISPRUDENCIA',
      digesto: 'DIGESTO',
    };
    for (const role of roleNames) {
      const response = await request(httpServer())
        .post('/api/auth/login')
        .send(credentials.accounts[role])
        .expect(201);
      const loginBody = responseBody<LoginResponse>(response.body);
      tokens[role] = loginBody.accessToken;
      userIds[role] = loginBody.user.id;
      await request(httpServer())
        .get('/api/auth/me')
        .set(auth(role))
        .expect(200)
        .expect(({ body }) => {
          const meBody = responseBody<AuthMeResponse>(body);
          expect(meBody.rol.nombre).toBe(expectedRoles[role]);
        });
    }

    const storageRoot = process.env.BJC_CORPUS_STORAGE_PATH?.trim();
    if (!storageRoot) throw new Error('SPRINT10_QA_STORAGE_REQUIRED');
    let fixtureSource = await prisma.corpusSourceSystem.findUnique({
      where: { code: 'DIGESTO_LOCAL' },
    });
    if (!fixtureSource) {
      fixtureSource = await prisma.corpusSourceSystem.create({
        data: {
          code: 'DIGESTO_LOCAL',
          name: 'Digesto sintético de integración QA',
          sourceType: 'FIXTURE',
          metadata: { testFixture: true },
        },
      });
      fixtureSourceCreated = true;
    }
    fixtureSourceId = fixtureSource.id;
    const marker = `sprint10${randomUUID().replaceAll('-', '')}`;
    fixtureSearchTerm = marker;
    const text = `Synthetic Digesto civil fixture ${marker} responsabilidad civil`;
    const fixtureBytes = readFileSync(
      resolve(process.cwd(), 'scripts/dev/fixtures/corpus/fallo-fixture.pdf'),
    );
    const storageKey = `sprint10/${marker}.pdf`;
    fixtureFilePath = resolve(storageRoot, storageKey);
    mkdirSync(resolve(fixtureFilePath, '..'), { recursive: true });
    writeFileSync(fixtureFilePath, fixtureBytes);
    const checksum = createHash('sha256').update(fixtureBytes).digest('hex');
    const fixtureDocument = await prisma.corpusDocument.create({
      data: {
        title: `Fallo Digesto QA ${marker}`,
        status: 'INDEXED',
        visibility: 'INTERNAL',
        searchText: text,
      },
    });
    fixtureDocumentIds.push(fixtureDocument.id);
    fixtureDocumentId = fixtureDocument.id;
    const fixtureFile = await prisma.corpusDocumentFile.create({
      data: {
        documentId: fixtureDocument.id,
        storageKey,
        originalFilename: `fallo-${marker}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: BigInt(fixtureBytes.byteLength),
        sha256: checksum,
        pageCount: 1,
      },
    });
    const fixtureExtraction = await prisma.corpusExtraction.create({
      data: {
        documentId: fixtureDocument.id,
        fileId: fixtureFile.id,
        extractor: 'qa-synthetic-fixture',
        extractorVersion: '1',
        status: 'SUCCESS',
        text,
        pages: {
          create: [
            {
              pageNumber: 1,
              text,
              textKind: 'NATIVE',
              processingStatus: 'TEXT_NATIVE',
            },
          ],
        },
      },
    });
    await prisma.corpusDocument.update({
      where: { id: fixtureDocument.id },
      data: { latestExtractionId: fixtureExtraction.id },
    });
    const fixtureCollection = await prisma.digestoCollection.create({
      data: {
        name: `Sprint 10 fixture ${marker}`,
        normalized: `sprint10-fixture-${marker}`,
      },
    });
    fixtureCollectionId = fixtureCollection.id;
    await prisma.digestoCollectionMembership.create({
      data: {
        collectionId: fixtureCollection.id,
        documentId: fixtureDocument.id,
      },
    });
    await prisma.corpusIngestionRecord.create({
      data: {
        sourceSystemId: fixtureSource.id,
        documentId: fixtureDocument.id,
        fileId: fixtureFile.id,
        externalId: marker,
        checksum,
        idempotencyKey: marker,
        originalFilename: `fallo-${marker}.pdf`,
        status: 'INDEXED',
        metadataOriginal: { testFixture: true },
      },
    });
  }, 120_000);

  afterAll(async () => {
    if (!enabled) return;
    if (!app || !prisma) {
      if (app) await app.close();
      return;
    }
    for (const id of fixtureDocumentIds)
      await prisma.accionLog.deleteMany({
        where: { datosDespues: { path: ['documentId'], equals: id } },
      });
    if (actionLogIds.length)
      await prisma.accionLog.deleteMany({
        where: { id: { in: actionLogIds } },
      });
    if (fixtureDocumentIds.length)
      await prisma.corpusDocument.deleteMany({
        where: { id: { in: fixtureDocumentIds } },
      });
    if (fixtureCollectionId)
      await prisma.digestoCollection.deleteMany({
        where: { id: fixtureCollectionId },
      });
    if (fixtureSourceCreated && fixtureSourceId)
      await prisma.corpusSourceSystem.deleteMany({
        where: { id: fixtureSourceId },
      });
    if (jurisprudenciaSourceCreated && jurisprudenciaSourceId)
      await prisma.corpusSourceSystem.deleteMany({
        where: { id: jurisprudenciaSourceId },
      });
    if (fixtureFilePath) rmSync(fixtureFilePath, { force: true });
    if (sumarioId)
      await prisma.accionLog.deleteMany({
        where: { entidad: 'SUMARIO', entidadId: sumarioId },
      });
    if (sumarioId)
      await prisma.sumario.deleteMany({ where: { id: sumarioId } });
    if (sentenceId)
      await prisma.sentencia.deleteMany({ where: { id: sentenceId } });
    if (collectionId) {
      await prisma.accionLog.deleteMany({
        where: {
          datosDespues: { path: ['collectionId'], equals: collectionId },
        },
      });
      await prisma.digestoCollection.deleteMany({
        where: { id: collectionId },
      });
    }
    if (topicId) {
      await prisma.accionLog.deleteMany({
        where: { datosDespues: { path: ['topicId'], equals: topicId } },
      });
      await prisma.digestoTopic.deleteMany({ where: { id: topicId } });
    }
    if (tagId) {
      await prisma.accionLog.deleteMany({
        where: { datosDespues: { path: ['tagId'], equals: tagId } },
      });
      await prisma.digestoTag.deleteMany({ where: { id: tagId } });
    }

    const runtime = app.get(OpenSearchRuntimeService);
    const deadline = Date.now() + 30_000;
    let pending = Number.POSITIVE_INFINITY;
    let failed = Number.POSITIVE_INFINITY;
    while (Date.now() < deadline) {
      await runtime.syncWorker.tick();
      [pending, failed] = await Promise.all([
        prisma.searchIndexOutbox.count({
          where: { processedAt: null, failedAt: null },
        }),
        prisma.searchIndexOutbox.count({ where: { failedAt: { not: null } } }),
      ]);
      if (pending === 0 || failed > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(pending).toBe(0);
    expect(failed).toBe(0);
    await app.close();
  }, 120_000);

  (enabled ? it : it.skip)(
    'runs authenticated search, read/download, role ACL, Digesto and Jurisprudencia curation with cleanup',
    async () => {
      // Exercise Digesto search using the isolated PDF/document fixture above.
      // Historical corpus clones may contain metadata without general-search
      // eligibility, so selecting an arbitrary legacy row made this assertion
      // depend on unrelated production-corpus state.
      await request(httpServer())
        .get(`/api/corpus/documents/${fixtureDocumentId}`)
        .set(auth('reader'))
        .expect(200);
      const fixtureMatches = await request(httpServer())
        .get(`/api/corpus/documents/${fixtureDocumentId}/matches`)
        .query({ q: fixtureSearchTerm })
        .set(auth('reader'))
        .expect(200);
      expect(
        responseBody<MatchesResponse>(fixtureMatches.body).total,
      ).toBeGreaterThan(0);
      // This historical corpus clone deliberately omits backing blobs. File
      // range coverage belongs to the self-contained PDF fixture in the
      // Sprint 15.6.1 integration test, which uploads the bytes to isolated QA
      // storage before exercising the viewer/download routes.
      const source = await prisma.corpusSourceSystem.findUniqueOrThrow({
        where: { code: 'DIGESTO_LOCAL' },
      });
      const marker = `sprint10${randomUUID().replaceAll('-', '')}`;
      const digestoDoc = await prisma.corpusDocument.create({
        data: {
          title: `Fixture ${marker}`,
          status: 'INDEXED',
          visibility: 'INTERNAL',
          searchText: `responsabilidad civil ${marker}`,
        },
      });
      documentId = digestoDoc.id;
      fixtureDocumentIds.push(documentId);
      await prisma.corpusIngestionRecord.create({
        data: {
          sourceSystemId: source.id,
          documentId,
          checksum: createHash('sha256').update(marker).digest('hex'),
          idempotencyKey: marker,
          originalFilename: 'fixture-sprint10.pdf',
          metadataOriginal: { testFixture: true },
        },
      });

      await request(httpServer())
        .get(`/api/corpus/documents/${documentId}`)
        .set(auth('reader'))
        .expect(200);
      await request(httpServer())
        .patch(`/api/corpus/curation/documents/${documentId}/jurisprudence`)
        .set(auth('reader'))
        .send({ status: 'REVIEW_PENDING' })
        .expect(403);
      await request(httpServer())
        .get('/api/corpus/documents/admin/summary')
        .set(auth('reader'))
        .expect(403);

      const collectionResponse = await request(httpServer())
        .post('/api/corpus/curation/digesto/collections')
        .set(auth('digesto'))
        .send({ name: `Sprint 10 ${marker}` })
        .expect(201);
      collectionId = responseBody<IdResponse>(collectionResponse.body).id;
      const membershipPreview = await request(httpServer())
        .post(
          `/api/corpus/curation/digesto/collections/${collectionId}/memberships/preview`,
        )
        .set(auth('digesto'))
        .send({ documentIds: [documentId] })
        .expect(201);
      expect(
        responseBody<MembershipResponse>(membershipPreview.body).results,
      ).toEqual([{ documentId, status: 'would_add' }]);
      const membershipBatch = await request(httpServer())
        .post(
          `/api/corpus/curation/digesto/collections/${collectionId}/memberships`,
        )
        .set(auth('digesto'))
        .send({ documentIds: [documentId] })
        .expect(201);
      expect(
        responseBody<MembershipResponse>(membershipBatch.body).results,
      ).toEqual([{ documentId, status: 'added' }]);
      await request(httpServer())
        .post(
          `/api/corpus/curation/documents/${documentId}/digesto/collections/${collectionId}`,
        )
        .set(auth('digesto'))
        .expect(201);
      const topicResponse = await request(httpServer())
        .post('/api/corpus/curation/digesto/topics')
        .set(auth('digesto'))
        .send({ name: `Tema ${marker}` })
        .expect(201);
      topicId = responseBody<IdResponse>(topicResponse.body).id;
      const tagResponse = await request(httpServer())
        .post('/api/corpus/curation/digesto/tags')
        .set(auth('digesto'))
        .send({ name: `Tag ${marker}` })
        .expect(201);
      tagId = responseBody<IdResponse>(tagResponse.body).id;
      await request(httpServer())
        .post(
          `/api/corpus/curation/documents/${documentId}/digesto/topics/${topicId}`,
        )
        .set(auth('digesto'))
        .expect(201);
      await request(httpServer())
        .post(
          `/api/corpus/curation/documents/${documentId}/digesto/tags/${tagId}`,
        )
        .set(auth('digesto'))
        .expect(201);
      const digestoCatalog = await request(httpServer())
        .get('/api/corpus/curation/digesto/collections')
        .set(auth('digesto'))
        .expect(200);
      expect(
        responseBody<CatalogResponse>(digestoCatalog.body).some(
          (item) => item.id === collectionId,
        ),
      ).toBe(true);
      const digestoDetail = await request(httpServer())
        .get(`/api/corpus/curation/digesto/collections/${collectionId}`)
        .set(auth('digesto'))
        .expect(200);
      expect(
        responseBody<CollectionDetailResponse>(
          digestoDetail.body,
        ).documents.some((item) => item.id === documentId),
      ).toBe(true);
      await request(httpServer())
        .get('/api/corpus/curation/digesto/topics')
        .set(auth('digesto'))
        .expect(200)
        .expect(({ body }) => {
          expect(
            responseBody<CatalogResponse>(body).some(
              (item) => item.id === topicId,
            ),
          ).toBe(true);
        });
      await request(httpServer())
        .get('/api/corpus/curation/digesto/tags')
        .set(auth('digesto'))
        .expect(200)
        .expect(({ body }) => {
          expect(
            responseBody<CatalogResponse>(body).some(
              (item) => item.id === tagId,
            ),
          ).toBe(true);
        });
      const batchClassification =
        await prisma.corpusDocumentClassification.create({
          data: {
            documentId,
            category: 'TOPIC',
            value: `Batch ${marker}`,
            origin: 'RULE',
            confidence: 0.8,
          },
        });
      await request(httpServer())
        .post('/api/corpus/curation/classifications/batch')
        .set(auth('reader'))
        .send({ ids: [batchClassification.id], status: 'APPROVED' })
        .expect(403);
      await request(httpServer())
        .post('/api/corpus/curation/classifications/batch')
        .set(auth('reviewer'))
        .send({ ids: [batchClassification.id], status: 'APPROVED' })
        .expect(201);
      const batchAudit = await prisma.accionLog.findFirst({
        where: {
          accion: 'CLASSIFICATION_BATCH_APPROVED',
          usuarioId: userIds.reviewer,
          datosDespues: {
            path: ['classificationIds'],
            array_contains: [batchClassification.id],
          },
        },
        select: {
          id: true,
          usuarioId: true,
          datosDespues: true,
          createdAt: true,
        },
      });
      expect(batchAudit?.usuarioId).toBe(userIds.reviewer);
      expect(
        (batchAudit?.datosDespues as { documentIds?: string[] }).documentIds,
      ).toContain(documentId);
      expect(batchAudit?.createdAt).toBeInstanceOf(Date);
      if (batchAudit) actionLogIds.push(batchAudit.id);
      const indexedSearch = await waitForIndexedResult(
        { q: marker, digestoCollectionId: collectionId },
        documentId,
        'reader',
      );
      const indexedSearchBody = responseBody<SearchResponse>(
        indexedSearch.body,
      );
      expect(indexedSearchBody.federated.total).toBeGreaterThan(0);
      expect(
        indexedSearchBody.federated.results.every(
          (item) => item.sourceSystem === 'CORPUS',
        ),
      ).toBe(true);
      await request(httpServer())
        .post(
          `/api/corpus/curation/documents/${documentId}/digesto/collections/${collectionId}`,
        )
        .set(auth('reader'))
        .expect(403);
      await request(httpServer())
        .post(
          `/api/corpus/curation/documents/${documentId}/digesto/collections/${collectionId}`,
        )
        .set(auth('operator'))
        .expect(201);
      await request(httpServer())
        .delete(
          `/api/corpus/curation/documents/${documentId}/digesto/collections/${collectionId}`,
        )
        .set(auth('operator'))
        .expect(200);

      let jurisSource = await prisma.corpusSourceSystem.findUnique({
        where: { code: 'JURISPRUDENCIA_LOCAL_PDF' },
      });
      if (!jurisSource) {
        jurisSource = await prisma.corpusSourceSystem.create({
          data: {
            code: 'JURISPRUDENCIA_LOCAL_PDF',
            name: 'Jurisprudencia sintética de integración QA',
            sourceType: 'FIXTURE',
            metadata: { testFixture: true },
          },
        });
        jurisprudenciaSourceCreated = true;
      }
      jurisprudenciaSourceId = jurisSource.id;
      const jurisDoc = await prisma.corpusDocument.create({
        data: {
          title: `Fixture Juris ${marker}`,
          status: 'INDEXED',
          visibility: 'INTERNAL',
          searchText: marker,
        },
      });
      const jurisDocumentId = jurisDoc.id;
      fixtureDocumentIds.push(jurisDocumentId);
      await prisma.corpusIngestionRecord.create({
        data: {
          sourceSystemId: jurisSource.id,
          documentId: jurisDocumentId,
          checksum: createHash('sha256')
            .update(`${marker}-juris`)
            .digest('hex'),
          idempotencyKey: `${marker}-juris`,
          originalFilename: 'fixture-juris-sprint10.pdf',
        },
      });
      const sentence = await prisma.sentencia.create({
        data: { caratula: `Fixture ${marker}` },
      });
      sentenceId = sentence.id;
      const sumario = await request(httpServer())
        .post('/api/sumarios')
        .set(auth('jurisprudencia'))
        .send({
          tema: 'Tema inicial',
          texto: `Sumario fixture ${marker}`,
          sentenciaId: sentenceId,
        })
        .expect(201);
      sumarioId = responseBody<SumarioResponse>(sumario.body).data.id;
      await request(httpServer())
        .patch(`/api/sumarios/${sumarioId}`)
        .set(auth('jurisprudencia'))
        .send({
          tema: 'Tema actualizado',
          texto: `Sumario actualizado ${marker}`,
        })
        .expect(200);
      await request(httpServer())
        .get(`/api/sumarios/${sumarioId}`)
        .set(auth('jurisprudencia'))
        .expect(200)
        .expect(({ body }) => {
          expect(responseBody<SumarioResponse>(body).data.tema).toBe(
            'Tema actualizado',
          );
        });
      const association = await prisma.corpusDocumentAssociation.create({
        data: {
          documentId: jurisDocumentId,
          targetDomain: 'JURISPRUDENCIA',
          targetType: 'SENTENCIA',
          targetId: String(sentence.id),
          confidence: 'CANDIDATE',
        },
      });
      associationId = association.id;
      const classification = await prisma.corpusDocumentClassification.create({
        data: {
          documentId: jurisDocumentId,
          category: 'TOPIC',
          value: marker,
          origin: 'RULE',
          confidence: 0.9,
        },
      });
      classificationId = classification.id;
      const reviewerQueue = await request(httpServer())
        .get('/api/corpus/documents/admin/review')
        .query({ filter: 'classification' })
        .set(auth('reviewer'))
        .expect(200);
      expect(
        responseBody<ReviewQueueResponse>(reviewerQueue.body).results.some(
          (item) =>
            item.classifications?.some(
              (entry) => entry.id === classificationId,
            ),
        ),
      ).toBe(true);
      await request(httpServer())
        .patch(`/api/corpus/curation/classifications/${classificationId}`)
        .set(auth('reader'))
        .send({ status: 'APPROVED' })
        .expect(403);
      await request(httpServer())
        .patch(`/api/corpus/curation/classifications/${classificationId}`)
        .set(auth('reviewer'))
        .send({ status: 'APPROVED' })
        .expect(200);
      await request(httpServer())
        .post(`/api/corpus/curation/classifications/${classificationId}/revert`)
        .set(auth('reviewer'))
        .send({ reason: 'Revisión de reversibilidad Sprint 11' })
        .expect(201)
        .expect(({ body }) => {
          expect(responseBody<StatusResponse>(body).status).toBe('SUGGESTED');
        });
      expect(
        (
          await prisma.corpusDocumentClassification.findUniqueOrThrow({
            where: { id: classificationId },
            select: { reviewStatus: true },
          })
        ).reviewStatus,
      ).toBe('SUGGESTED');
      await request(httpServer())
        .patch(`/api/corpus/curation/associations/${associationId}`)
        .set(auth('jurisprudencia'))
        .send({ status: 'APPROVED' })
        .expect(200);
      const reviewPreview = await request(httpServer())
        .post(
          '/api/corpus/curation/documents/jurisprudence/review-pending/batch/preview',
        )
        .set(auth('jurisprudencia'))
        .send({ documentIds: [jurisDocumentId] })
        .expect(201);
      expect(
        responseBody<MembershipResponse>(reviewPreview.body).results,
      ).toEqual([
        { documentId: jurisDocumentId, status: 'would_send_to_review' },
      ]);
      const reviewBatch = await request(httpServer())
        .post(
          '/api/corpus/curation/documents/jurisprudence/review-pending/batch',
        )
        .set(auth('jurisprudencia'))
        .send({ documentIds: [jurisDocumentId] })
        .expect(201);
      expect(
        responseBody<MembershipResponse>(reviewBatch.body).results,
      ).toEqual([{ documentId: jurisDocumentId, status: 'sent_to_review' }]);
      const documentAudit = await request(httpServer())
        .get('/api/logs')
        .query({
          documentId: jurisDocumentId,
          accion: 'JURISPRUDENCE_REVIEW_PENDING',
        })
        .set(auth('admin'))
        .expect(200);
      expect(
        responseBody<AuditResponse>(documentAudit.body).data.length,
      ).toBeGreaterThan(0);
      const auditCsv = await request(httpServer())
        .get('/api/logs/export.csv')
        .query({ documentId: jurisDocumentId })
        .set(auth('admin'))
        .expect(200)
        .expect('Content-Type', /text\/csv/u);
      expect(auditCsv.text).toContain('JURISPRUDENCE_REVIEW_PENDING');
      await request(httpServer())
        .patch(
          `/api/corpus/curation/documents/${jurisDocumentId}/jurisprudence`,
        )
        .set(auth('jurisprudencia'))
        .send({
          status: 'SELECTED',
          reason: 'CASO_NOVEDOSO',
          note: 'Fixture de aceptación',
        })
        .expect(200);
      const detail = await request(httpServer())
        .get(`/api/corpus/curation/documents/${jurisDocumentId}`)
        .set(auth('reader'))
        .expect(200);
      const detailBody = responseBody<JurisprudenceDetailResponse>(detail.body);
      expect(detailBody.editorialStatus).toBe('SELECTED');
      expect(detailBody.metadata.jurisprudenceCuration.reason).toBe(
        'CASO_NOVEDOSO',
      );
      expect(detailBody.history.map((event) => event.accion)).toContain(
        'JURISPRUDENCE_SELECTED',
      );
      await request(httpServer())
        .get('/api/corpus/documents/admin/summary')
        .set(auth('admin'))
        .expect(200);

      await request(httpServer())
        .delete(
          `/api/corpus/curation/documents/${documentId}/digesto/collections/${collectionId}`,
        )
        .set(auth('digesto'))
        .expect(200);
    },
    120_000,
  );

  (enabled ? it : it.skip)(
    'rejects invalid authentication inputs and tampered tokens through HTTP',
    async () => {
      const reader = credentials.accounts.reader;
      const wrongPassword = await request(httpServer())
        .post('/api/auth/login')
        .send({ email: reader.email, password: `${reader.password}-wrong` });
      const unknownUser = await request(httpServer())
        .post('/api/auth/login')
        .send({
          email: `unknown-${randomUUID()}@example.invalid`,
          password: reader.password,
        });
      const emptyCredentials = await request(httpServer())
        .post('/api/auth/login')
        .send({ email: '', password: '' });
      const malformedCredentials = await request(httpServer())
        .post('/api/auth/login')
        .send({ email: 'not-an-email', password: '123456' });
      const missingToken = await request(httpServer())
        .get('/api/auth/me')
        .expect(401);
      const invalidToken = await request(httpServer())
        .get('/api/auth/me')
        .set('Authorization', 'Bearer not-a-jwt')
        .expect(401);
      const tokenParts = tokens.reader.split('.');
      const tamperedPayload = JSON.parse(
        Buffer.from(tokenParts[1], 'base64url').toString('utf8'),
      ) as Record<string, unknown>;
      tamperedPayload.rol = 'ADMIN';
      tokenParts[1] = Buffer.from(JSON.stringify(tamperedPayload)).toString(
        'base64url',
      );
      const tamperedToken = await request(httpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${tokenParts.join('.')}`)
        .expect(401);

      const result = {
        capturedAt: new Date().toISOString(),
        cases: {
          validLoginAndMe: 'PASS',
          wrongPassword: wrongPassword.status,
          unknownUser: unknownUser.status,
          emptyCredentials: emptyCredentials.status,
          malformedCredentials: malformedCredentials.status,
          missingToken: missingToken.status,
          invalidToken: invalidToken.status,
          tamperedRoleToken: tamperedToken.status,
          roleTamperingRejected: true,
        },
        pass:
          wrongPassword.status === 401 &&
          unknownUser.status === 401 &&
          emptyCredentials.status === 400 &&
          malformedCredentials.status === 400 &&
          missingToken.status === 401 &&
          invalidToken.status === 401 &&
          tamperedToken.status === 401,
      };
      const artifactRoot = process.env.BJC_AUTH_ARTIFACT_ROOT;
      if (artifactRoot) {
        mkdirSync(artifactRoot, { recursive: true });
        writeFileSync(
          resolve(artifactRoot, 'auth-http-matrix.json'),
          `${JSON.stringify(result, null, 2)}\n`,
          'utf8',
        );
      }
      expect(result.pass).toBe(true);
    },
  );

  (enabled ? it : it.skip)(
    'enforces JWT expiry, live role changes, and user deactivation',
    async () => {
      const userId = userIds.reader;
      const original = await prisma.usuario.findUniqueOrThrow({
        where: { id: userId },
        select: {
          activo: true,
          rolId: true,
          email: true,
          rol: { select: { nombre: true } },
        },
      });
      const jwt = app.get(JwtService);
      try {
        const expired = await jwt.signAsync(
          { sub: userId, email: original.email, rol: original.rol.nombre },
          { expiresIn: '-1s' },
        );
        await request(httpServer())
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${expired}`)
          .expect(401);

        const reviewerRole = await prisma.rol.findUniqueOrThrow({
          where: { nombre: 'REVISOR' },
          select: { id: true },
        });
        await prisma.usuario.update({
          where: { id: userId },
          data: { rolId: reviewerRole.id },
        });
        await request(httpServer())
          .get('/api/auth/me')
          .set(auth('reader'))
          .expect(200)
          .expect(({ body }) => {
            expect(responseBody<AuthMeResponse>(body).rol.nombre).toBe(
              'REVISOR',
            );
          });

        await prisma.usuario.update({
          where: { id: userId },
          data: { activo: false },
        });
        await request(httpServer())
          .get('/api/auth/me')
          .set(auth('reader'))
          .expect(401);
      } finally {
        await prisma.usuario.update({
          where: { id: userId },
          data: { activo: original.activo, rolId: original.rolId },
        });
      }
    },
    120_000,
  );

  function auth(role: string) {
    return { Authorization: `Bearer ${tokens[role]}` };
  }

  async function waitForIndexedResult(
    query: Record<string, string>,
    expectedSourceId: string,
    role: string,
  ) {
    const deadline = Date.now() + 15_000;
    let found = false;
    const server = app.getHttpServer() as import('node:http').Server;
    while (Date.now() < deadline) {
      const response = await request(server)
        .get('/api/busqueda/avanzada')
        .query(query)
        .set(auth(role))
        .expect(200);
      const body = response.body as SearchResponse;
      found = body.federated.results.some(
        (item: { sourceId: string }) => item.sourceId === expectedSourceId,
      );
      if (found) return response;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(found).toBe(true);
  }
});

import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

const enabled = process.env.SPRINT10_POSTGRES_TEST === '1';
type Account = { email: string; password: string };
type Credentials = { accounts: Record<'admin' | 'operator' | 'reader' | 'reviewer' | 'jurisprudencia' | 'digesto', Account> };

describe('Sprint 10 authenticated pilot PostgreSQL E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let credentials: Credentials;
  let tokens: Record<string, string> = {};
  let userIds: Record<string, number> = {};
  let documentId = '';
  let associationId = '';
  let classificationId = '';
  let sentenceId = 0;
  let sumarioId = 0;
  let collectionId = '';
  let topicId = '';
  let tagId = '';
  const fixtureDocumentIds: string[] = [];
  const actionLogIds: number[] = [];

  beforeAll(async () => {
    if (!enabled) return;
    credentials = JSON.parse(readFileSync(resolve(process.cwd(), '../../_recovery-work/sprint10/acceptance/credentials.json'), 'utf8')) as Credentials;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    const roleNames = ['admin', 'operator', 'reader', 'reviewer', 'jurisprudencia', 'digesto'] as const;
    const expectedRoles: Record<(typeof roleNames)[number], string> = { admin: 'ADMIN', operator: 'OPERADOR', reader: 'LECTOR', reviewer: 'REVISOR', jurisprudencia: 'JURISPRUDENCIA', digesto: 'DIGESTO' };
    for (const role of roleNames) {
      const response = await request(app.getHttpServer()).post('/api/auth/login').send(credentials.accounts[role]).expect(201);
      tokens[role] = response.body.accessToken as string;
      userIds[role] = response.body.user.id as number;
      await request(app.getHttpServer()).get('/api/auth/me').set(auth(role)).expect(200).expect(({ body }) => expect(body.rol.nombre).toBe(expectedRoles[role]));
    }
  }, 120_000);

  afterAll(async () => {
    if (!enabled) return;
    for (const id of fixtureDocumentIds) await prisma.accionLog.deleteMany({ where: { datosDespues: { path: ['documentId'], equals: id } } });
    if (actionLogIds.length) await prisma.accionLog.deleteMany({ where: { id: { in: actionLogIds } } });
    if (fixtureDocumentIds.length) await prisma.corpusDocument.deleteMany({ where: { id: { in: fixtureDocumentIds } } });
    if (sumarioId) await prisma.accionLog.deleteMany({ where: { entidad: 'SUMARIO', entidadId: sumarioId } });
    if (sumarioId) await prisma.sumario.deleteMany({ where: { id: sumarioId } });
    if (sentenceId) await prisma.sentencia.deleteMany({ where: { id: sentenceId } });
    if (collectionId) {
      await prisma.accionLog.deleteMany({ where: { datosDespues: { path: ['collectionId'], equals: collectionId } } });
      await prisma.digestoCollection.deleteMany({ where: { id: collectionId } });
    }
    if (topicId) {
      await prisma.accionLog.deleteMany({ where: { datosDespues: { path: ['topicId'], equals: topicId } } });
      await prisma.digestoTopic.deleteMany({ where: { id: topicId } });
    }
    if (tagId) {
      await prisma.accionLog.deleteMany({ where: { datosDespues: { path: ['tagId'], equals: tagId } } });
      await prisma.digestoTag.deleteMany({ where: { id: tagId } });
    }
    await app.close();
  }, 120_000);

  (enabled ? it : it.skip)('runs authenticated search, read/download, role ACL, Digesto and Jurisprudencia curation with cleanup', async () => {
    const realDigesto = await prisma.corpusDocument.findFirstOrThrow({
      where: { status: 'INDEXED', visibility: 'INTERNAL', ingestions: { some: { sourceSystem: { is: { code: 'DIGESTO_LOCAL' } } } }, digestoCollections: { some: {} } },
      orderBy: { id: 'asc' },
      select: { id: true, searchText: true, latestExtraction: { select: { pages: { orderBy: { pageNumber: 'asc' }, take: 1, select: { text: true } } } }, digestoCollections: { take: 1, select: { collectionId: true } } },
    });
    const realText = realDigesto.latestExtraction?.pages[0]?.text ?? '';
    const realTerm = realDigesto.searchText.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{5,}/u)?.[0] ?? realText.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{5,}/u)?.[0];
    expect(realTerm).toBeTruthy();
    await request(app.getHttpServer()).get(`/api/corpus/documents/${realDigesto.id}`).set(auth('reader')).expect(200);
    const realMatches = await request(app.getHttpServer()).get(`/api/corpus/documents/${realDigesto.id}/matches`).query({ q: realTerm }).set(auth('reader')).expect(200);
    expect(realMatches.body.total).toBeGreaterThan(0);
    await request(app.getHttpServer()).get(`/api/corpus/documents/${realDigesto.id}/file`).set(auth('reader')).set('Range', 'bytes=0-31').expect(206).expect('X-Content-Type-Options', 'nosniff');
    const realSearch = await request(app.getHttpServer()).get('/api/busqueda/avanzada').query({ q: realTerm, digestoCollectionId: realDigesto.digestoCollections[0].collectionId }).set(auth('reader')).expect(200);
    expect(realSearch.body.federated.total).toBeGreaterThan(0);
    expect(realSearch.body.federated.results.every((item: { sourceSystem: string }) => item.sourceSystem === 'CORPUS')).toBe(true);

    const source = await prisma.corpusSourceSystem.findUniqueOrThrow({ where: { code: 'DIGESTO_LOCAL' } });
    const marker = `sprint10${randomUUID().replaceAll('-', '')}`;
    const digestoDoc = await prisma.corpusDocument.create({ data: { title: `Fixture ${marker}`, status: 'INDEXED', visibility: 'INTERNAL', searchText: `responsabilidad civil ${marker}` } });
    documentId = digestoDoc.id;
    fixtureDocumentIds.push(documentId);
    await prisma.corpusIngestionRecord.create({ data: { sourceSystemId: source.id, documentId, checksum: createHash('sha256').update(marker).digest('hex'), idempotencyKey: marker, originalFilename: 'fixture-sprint10.pdf', metadataOriginal: { testFixture: true } } });

    const readerSearch = await request(app.getHttpServer()).get('/api/busqueda/avanzada').query({ q: marker }).set(auth('reader')).expect(200);
    expect(readerSearch.body.federated.results.some((item: { sourceId: string }) => item.sourceId === documentId)).toBe(true);
    await request(app.getHttpServer()).get(`/api/corpus/documents/${documentId}`).set(auth('reader')).expect(200);
    await request(app.getHttpServer()).patch(`/api/corpus/curation/documents/${documentId}/jurisprudence`).set(auth('reader')).send({ status: 'REVIEW_PENDING' }).expect(403);
    await request(app.getHttpServer()).get('/api/corpus/documents/admin/summary').set(auth('reader')).expect(403);

    const collectionResponse = await request(app.getHttpServer()).post('/api/corpus/curation/digesto/collections').set(auth('digesto')).send({ name: `Sprint 10 ${marker}` }).expect(201);
    collectionId = collectionResponse.body.id as string;
    const membershipPreview = await request(app.getHttpServer()).post(`/api/corpus/curation/digesto/collections/${collectionId}/memberships/preview`).set(auth('digesto')).send({ documentIds: [documentId] }).expect(201);
    expect(membershipPreview.body.results).toEqual([{ documentId, status: 'would_add' }]);
    const membershipBatch = await request(app.getHttpServer()).post(`/api/corpus/curation/digesto/collections/${collectionId}/memberships`).set(auth('digesto')).send({ documentIds: [documentId] }).expect(201);
    expect(membershipBatch.body.results).toEqual([{ documentId, status: 'added' }]);
    await request(app.getHttpServer()).post(`/api/corpus/curation/documents/${documentId}/digesto/collections/${collectionId}`).set(auth('digesto')).expect(201);
    const topicResponse = await request(app.getHttpServer()).post('/api/corpus/curation/digesto/topics').set(auth('digesto')).send({ name: `Tema ${marker}` }).expect(201);
    topicId = topicResponse.body.id as string;
    const tagResponse = await request(app.getHttpServer()).post('/api/corpus/curation/digesto/tags').set(auth('digesto')).send({ name: `Tag ${marker}` }).expect(201);
    tagId = tagResponse.body.id as string;
    await request(app.getHttpServer()).post(`/api/corpus/curation/documents/${documentId}/digesto/topics/${topicId}`).set(auth('digesto')).expect(201);
    await request(app.getHttpServer()).post(`/api/corpus/curation/documents/${documentId}/digesto/tags/${tagId}`).set(auth('digesto')).expect(201);
    const digestoCatalog = await request(app.getHttpServer()).get('/api/corpus/curation/digesto/collections').set(auth('digesto')).expect(200);
    expect(digestoCatalog.body.some((item: { id: string }) => item.id === collectionId)).toBe(true);
    const digestoDetail = await request(app.getHttpServer()).get(`/api/corpus/curation/digesto/collections/${collectionId}`).set(auth('digesto')).expect(200);
    expect(digestoDetail.body.documents.some((item: { id: string }) => item.id === documentId)).toBe(true);
    await request(app.getHttpServer()).get('/api/corpus/curation/digesto/topics').set(auth('digesto')).expect(200).expect(({ body }) => expect(body.some((item: { id: string }) => item.id === topicId)).toBe(true));
    await request(app.getHttpServer()).get('/api/corpus/curation/digesto/tags').set(auth('digesto')).expect(200).expect(({ body }) => expect(body.some((item: { id: string }) => item.id === tagId)).toBe(true));
    const batchClassification = await prisma.corpusDocumentClassification.create({ data: { documentId, category: 'TOPIC', value: `Batch ${marker}`, origin: 'RULE', confidence: 0.8 } });
    await request(app.getHttpServer()).post('/api/corpus/curation/classifications/batch').set(auth('reader')).send({ ids: [batchClassification.id], status: 'APPROVED' }).expect(403);
    await request(app.getHttpServer()).post('/api/corpus/curation/classifications/batch').set(auth('reviewer')).send({ ids: [batchClassification.id], status: 'APPROVED' }).expect(201);
    const batchAudit = await prisma.accionLog.findFirst({ where: { accion: 'CLASSIFICATION_BATCH_APPROVED', usuarioId: userIds.reviewer, datosDespues: { path: ['classificationIds'], array_contains: [batchClassification.id] } }, select: { id: true, usuarioId: true, datosDespues: true, createdAt: true } });
    expect(batchAudit?.usuarioId).toBe(userIds.reviewer);
    expect((batchAudit?.datosDespues as { documentIds?: string[] }).documentIds).toContain(documentId);
    expect(batchAudit?.createdAt).toBeInstanceOf(Date);
    if (batchAudit) actionLogIds.push(batchAudit.id);
    const collectionSearch = await request(app.getHttpServer()).get('/api/busqueda/avanzada').query({ q: marker, digestoCollectionId: collectionId }).set(auth('reader')).expect(200);
    expect(collectionSearch.body.federated.results.map((item: { sourceId: string }) => item.sourceId)).toContain(documentId);
    await request(app.getHttpServer()).post(`/api/corpus/curation/documents/${documentId}/digesto/collections/${collectionId}`).set(auth('reader')).expect(403);
    await request(app.getHttpServer()).post(`/api/corpus/curation/documents/${documentId}/digesto/collections/${collectionId}`).set(auth('operator')).expect(201);
    await request(app.getHttpServer()).delete(`/api/corpus/curation/documents/${documentId}/digesto/collections/${collectionId}`).set(auth('operator')).expect(200);

    const jurisSource = await prisma.corpusSourceSystem.findUniqueOrThrow({ where: { code: 'JURISPRUDENCIA_LOCAL_PDF' } });
    const jurisDoc = await prisma.corpusDocument.create({ data: { title: `Fixture Juris ${marker}`, status: 'INDEXED', visibility: 'INTERNAL', searchText: marker } });
    const jurisDocumentId = jurisDoc.id;
    fixtureDocumentIds.push(jurisDocumentId);
    await prisma.corpusIngestionRecord.create({ data: { sourceSystemId: jurisSource.id, documentId: jurisDocumentId, checksum: createHash('sha256').update(`${marker}-juris`).digest('hex'), idempotencyKey: `${marker}-juris`, originalFilename: 'fixture-juris-sprint10.pdf' } });
    const sentence = await prisma.sentencia.create({ data: { caratula: `Fixture ${marker}` } });
    sentenceId = sentence.id;
    const sumario = await request(app.getHttpServer()).post('/api/sumarios').set(auth('jurisprudencia')).send({ tema: 'Tema inicial', texto: `Sumario fixture ${marker}`, sentenciaId: sentenceId }).expect(201);
    sumarioId = sumario.body.data.id as number;
    await request(app.getHttpServer()).patch(`/api/sumarios/${sumarioId}`).set(auth('jurisprudencia')).send({ tema: 'Tema actualizado', texto: `Sumario actualizado ${marker}` }).expect(200);
    await request(app.getHttpServer()).get(`/api/sumarios/${sumarioId}`).set(auth('jurisprudencia')).expect(200).expect(({ body }) => expect(body.data.tema).toBe('Tema actualizado'));
    const association = await prisma.corpusDocumentAssociation.create({ data: { documentId: jurisDocumentId, targetDomain: 'JURISPRUDENCIA', targetType: 'SENTENCIA', targetId: String(sentence.id), confidence: 'CANDIDATE' } });
    associationId = association.id;
    const classification = await prisma.corpusDocumentClassification.create({ data: { documentId: jurisDocumentId, category: 'TOPIC', value: marker, origin: 'RULE', confidence: 0.9 } });
    classificationId = classification.id;
    const reviewerQueue = await request(app.getHttpServer()).get('/api/corpus/documents/admin/review').query({ filter: 'classification' }).set(auth('reviewer')).expect(200);
    expect(reviewerQueue.body.results.some((item: { classifications?: Array<{ id: string }> }) => item.classifications?.some((entry) => entry.id === classificationId))).toBe(true);
    await request(app.getHttpServer()).patch(`/api/corpus/curation/classifications/${classificationId}`).set(auth('reader')).send({ status: 'APPROVED' }).expect(403);
    await request(app.getHttpServer()).patch(`/api/corpus/curation/classifications/${classificationId}`).set(auth('reviewer')).send({ status: 'APPROVED' }).expect(200);
    await request(app.getHttpServer()).post(`/api/corpus/curation/classifications/${classificationId}/revert`).set(auth('reviewer')).send({ reason: 'Revisión de reversibilidad Sprint 11' }).expect(201).expect(({ body }) => expect(body.status).toBe('SUGGESTED'));
    expect((await prisma.corpusDocumentClassification.findUniqueOrThrow({ where: { id: classificationId }, select: { reviewStatus: true } })).reviewStatus).toBe('SUGGESTED');
    await request(app.getHttpServer()).patch(`/api/corpus/curation/associations/${associationId}`).set(auth('jurisprudencia')).send({ status: 'APPROVED' }).expect(200);
    const reviewPreview = await request(app.getHttpServer()).post('/api/corpus/curation/documents/jurisprudence/review-pending/batch/preview').set(auth('jurisprudencia')).send({ documentIds: [jurisDocumentId] }).expect(201);
    expect(reviewPreview.body.results).toEqual([{ documentId: jurisDocumentId, status: 'would_send_to_review' }]);
    const reviewBatch = await request(app.getHttpServer()).post('/api/corpus/curation/documents/jurisprudence/review-pending/batch').set(auth('jurisprudencia')).send({ documentIds: [jurisDocumentId] }).expect(201);
    expect(reviewBatch.body.results).toEqual([{ documentId: jurisDocumentId, status: 'sent_to_review' }]);
    const documentAudit = await request(app.getHttpServer()).get('/api/logs').query({ documentId: jurisDocumentId, accion: 'JURISPRUDENCE_REVIEW_PENDING' }).set(auth('admin')).expect(200);
    expect(documentAudit.body.data.length).toBeGreaterThan(0);
    const auditCsv = await request(app.getHttpServer()).get('/api/logs/export.csv').query({ documentId: jurisDocumentId }).set(auth('admin')).expect(200).expect('Content-Type', /text\/csv/u);
    expect(auditCsv.text).toContain('JURISPRUDENCE_REVIEW_PENDING');
    await request(app.getHttpServer()).patch(`/api/corpus/curation/documents/${jurisDocumentId}/jurisprudence`).set(auth('jurisprudencia')).send({ status: 'SELECTED', reason: 'CASO_NOVEDOSO', note: 'Fixture de aceptación' }).expect(200);
    const detail = await request(app.getHttpServer()).get(`/api/corpus/curation/documents/${jurisDocumentId}`).set(auth('reader')).expect(200);
    expect(detail.body.editorialStatus).toBe('SELECTED');
    expect(detail.body.metadata.jurisprudenceCuration.reason).toBe('CASO_NOVEDOSO');
    expect(detail.body.history.map((event: { accion: string }) => event.accion)).toContain('JURISPRUDENCE_SELECTED');
    await request(app.getHttpServer()).get('/api/corpus/documents/admin/summary').set(auth('admin')).expect(200);

    await request(app.getHttpServer()).delete(`/api/corpus/curation/documents/${documentId}/digesto/collections/${collectionId}`).set(auth('digesto')).expect(200);
  }, 120_000);

  (enabled ? it : it.skip)('enforces JWT expiry, live role changes, and user deactivation', async () => {
    const userId = userIds.reader;
    const original = await prisma.usuario.findUniqueOrThrow({ where: { id: userId }, select: { activo: true, rolId: true, email: true, rol: { select: { nombre: true } } } });
    const jwt = app.get(JwtService);
    try {
      const expired = await jwt.signAsync({ sub: userId, email: original.email, rol: original.rol.nombre }, { expiresIn: '-1s' });
      await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${expired}`).expect(401);

      const reviewerRole = await prisma.rol.findUniqueOrThrow({ where: { nombre: 'REVISOR' }, select: { id: true } });
      await prisma.usuario.update({ where: { id: userId }, data: { rolId: reviewerRole.id } });
      await request(app.getHttpServer()).get('/api/auth/me').set(auth('reader')).expect(200).expect(({ body }) => expect(body.rol.nombre).toBe('REVISOR'));

      await prisma.usuario.update({ where: { id: userId }, data: { activo: false } });
      await request(app.getHttpServer()).get('/api/auth/me').set(auth('reader')).expect(401);
    } finally {
      await prisma.usuario.update({ where: { id: userId }, data: { activo: original.activo, rolId: original.rolId } });
    }
  }, 120_000);

  function auth(role: string) {
    return { Authorization: `Bearer ${tokens[role]}` };
  }
});

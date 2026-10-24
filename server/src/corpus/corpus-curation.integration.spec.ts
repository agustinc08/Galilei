import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CorpusCurationService } from './corpus-curation.service';

const enabled = process.env.SPRINT9_POSTGRES_TEST === '1';

describe('Sprint 9 curation PostgreSQL integration', () => {
  const prisma = new PrismaService();
  const curation = new CorpusCurationService(prisma);
  let userId = 0;
  let sourceId = '';
  let ownsSource = false;
  let testUserId = 0;
  let testRoleId = 0;
  let documentId = '';
  let sentenceId = 0;
  let collectionId = '';

  beforeAll(async () => {
    if (!enabled) return;
    await prisma.$connect();
    const role = await prisma.rol.create({
      data: {
        nombre: `SPRINT9_TEST_${randomUUID()}`,
        descripcion: 'Rol temporal de test Sprint 9',
      },
    });
    testRoleId = role.id;
    const user = await prisma.usuario.create({
      data: {
        nombre: 'Sprint 9 test',
        email: `sprint9-${randomUUID()}@invalid.local`,
        passwordHash: 'not-a-login-hash',
        rolId: role.id,
      },
    });
    testUserId = user.id;
    userId = user.id;
    let source = await prisma.corpusSourceSystem.findUnique({
      where: { code: 'JURISPRUDENCIA_LOCAL_PDF' },
    });
    if (!source) {
      source = await prisma.corpusSourceSystem.create({
        data: {
          code: 'JURISPRUDENCIA_LOCAL_PDF',
          name: 'Synthetic Sprint 9 fixture',
          sourceType: 'FIXTURE',
        },
      });
      ownsSource = true;
    }
    sourceId = source.id;
  });

  afterEach(async () => {
    if (!enabled) return;
    if (documentId) {
      await prisma.accionLog.deleteMany({
        where: { datosDespues: { path: ['documentId'], equals: documentId } },
      });
      await prisma.corpusDocument.deleteMany({ where: { id: documentId } });
    }
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
    documentId = '';
    sentenceId = 0;
    collectionId = '';
  });

  afterAll(async () => {
    if (!enabled) return;
    if (testUserId)
      await prisma.accionLog.deleteMany({ where: { usuarioId: testUserId } });
    if (testUserId)
      await prisma.usuario.deleteMany({ where: { id: testUserId } });
    if (testRoleId) await prisma.rol.deleteMany({ where: { id: testRoleId } });
    if (ownsSource)
      await prisma.corpusSourceSystem.deleteMany({ where: { id: sourceId } });
    await prisma.$disconnect();
  });

  (enabled ? it : it.skip)(
    'reviews a link and topic, selects with a reason, adds Digesto membership, and reads one audit timeline',
    async () => {
      const marker = randomUUID();
      const sentence = await prisma.sentencia.create({
        data: { caratula: `Sprint 9 synthetic ${marker}` },
      });
      sentenceId = sentence.id;
      const document = await prisma.corpusDocument.create({
        data: {
          title: `Sprint 9 synthetic ${marker}`,
          status: 'INDEXED',
          visibility: 'INTERNAL',
          editorialStatus: 'NO_REVIEWED',
        },
      });
      documentId = document.id;
      await prisma.corpusIngestionRecord.create({
        data: {
          sourceSystemId: sourceId,
          documentId,
          checksum: marker.replaceAll('-', ''),
          idempotencyKey: `sprint9-${marker}`,
          originalFilename: 'synthetic.pdf',
        },
      });
      const association = await prisma.corpusDocumentAssociation.create({
        data: {
          documentId,
          targetDomain: 'JURISPRUDENCIA',
          targetType: 'SENTENCIA',
          targetId: String(sentenceId),
          confidence: 'HIGH_CONFIDENCE',
        },
      });
      expect(
        await curation.reviewAssociation(
          association.id,
          'APPROVED',
          userId,
          true,
        ),
      ).toMatchObject({ status: 'APPROVED', sentenceId });
      expect(
        await curation.setJurisprudence(
          documentId,
          'REVIEW_PENDING',
          undefined,
          undefined,
          userId,
          true,
        ),
      ).toMatchObject({ status: 'REVIEW_PENDING' });
      expect(
        await curation.setJurisprudence(
          documentId,
          'SELECTED',
          'CASO_NOVEDOSO',
          undefined,
          userId,
          true,
        ),
      ).toMatchObject({ status: 'SELECTED', reason: 'CASO_NOVEDOSO' });
      const classification = await prisma.corpusDocumentClassification.create({
        data: {
          documentId,
          category: 'TOPIC',
          value: 'Contratos',
          origin: 'RULE',
          confidence: 0.86,
        },
      });
      expect(
        await curation.reviewClassification(
          classification.id,
          'APPROVED',
          userId,
          true,
        ),
      ).toMatchObject({ status: 'APPROVED', value: 'Contratos' });
      const collection = await curation.createCollection(
        `Sprint 9 ${marker}`,
        'Fixture de prueba',
        userId,
      );
      collectionId = collection.id;
      await curation.addToCollection(documentId, collectionId, userId, true);
      const detail = await curation.document(documentId, true);
      expect(detail.editorialStatus).toBe('SELECTED');
      expect(detail.digestoCollections[0]?.collection.id).toBe(collectionId);
      expect(detail.history.map((event) => event.accion)).toEqual(
        expect.arrayContaining([
          'ASSOCIATION_APPROVED',
          'JURISPRUDENCE_SELECTED',
          'CLASSIFICATION_APPROVED',
          'DIGESTO_COLLECTION_ADDED',
        ]),
      );
      expect(
        await prisma.corpusDocumentLink.count({ where: { documentId } }),
      ).toBe(2);
    },
  );
});

import { randomUUID } from 'node:crypto';
import { LogsService } from '../logs/logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { SentenciasService } from './sentencias.service';

const enabled = process.env.SPRINT_J9_POSTGRES_TEST === '1';

describe('Sprint J9 PostgreSQL publication visibility', () => {
  const prisma = new PrismaService();
  const marker = randomUUID();
  let roleId: number | null = null;
  let userId: number | null = null;
  let sentenceId: number | null = null;
  let generalDocumentId: string | null = null;
  let privateDocumentId: string | null = null;

  beforeAll(async () => {
    if (enabled) await prisma.$connect();
  });
  afterAll(async () => {
    if (enabled) await prisma.$disconnect();
  });

  afterEach(async () => {
    if (!enabled) return;
    if (userId)
      await prisma.accionLog.deleteMany({ where: { usuarioId: userId } });
    if (generalDocumentId)
      await prisma.corpusDocumentLink.deleteMany({
        where: { documentId: generalDocumentId },
      });
    if (privateDocumentId)
      await prisma.corpusDocumentLink.deleteMany({
        where: { documentId: privateDocumentId },
      });
    if (sentenceId)
      await prisma.sentencia.deleteMany({ where: { id: sentenceId } });
    if (generalDocumentId)
      await prisma.corpusDocument.deleteMany({
        where: { id: generalDocumentId },
      });
    if (privateDocumentId)
      await prisma.corpusDocument.deleteMany({
        where: { id: privateDocumentId },
      });
    if (userId) await prisma.usuario.deleteMany({ where: { id: userId } });
    if (roleId) await prisma.rol.deleteMany({ where: { id: roleId } });
    roleId = null;
    userId = null;
    sentenceId = null;
    generalDocumentId = null;
    privateDocumentId = null;
  });

  (enabled ? it : it.skip)(
    'publishes only linked general documents and archives without deleting files',
    async () => {
      const role = await prisma.rol.create({
        data: {
          nombre: `SPRINT_J9_${marker}`,
          descripcion: 'Synthetic workflow test',
        },
      });
      roleId = role.id;
      const user = await prisma.usuario.create({
        data: {
          nombre: 'Synthetic J9',
          email: `sprint-j9-${marker}@invalid.local`,
          passwordHash: 'not-a-login-hash',
          rolId: role.id,
        },
      });
      userId = user.id;
      const sentence = await prisma.sentencia.create({
        data: {
          caratula: `Synthetic J9 ${marker}`,
          estadoCarga: 'BORRADOR',
          publicado: false,
          activo: true,
        },
      });
      sentenceId = sentence.id;
      const general = await prisma.corpusDocument.create({
        data: {
          title: `Synthetic J9 ${marker}`,
          jurisdiction: 'CIVIL',
          visibility: 'INTERNAL',
          documentScope: 'GENERAL',
          status: 'INDEXED',
        },
      });
      generalDocumentId = general.id;
      const privateDoc = await prisma.corpusDocument.create({
        data: {
          title: `Synthetic private J9 ${marker}`,
          jurisdiction: 'CIVIL',
          visibility: 'INTERNAL',
          documentScope: 'PRIVATE_WORKSPACE',
          status: 'INDEXED',
        },
      });
      privateDocumentId = privateDoc.id;
      await prisma.corpusDocumentLink.createMany({
        data: [general.id, privateDoc.id].map((documentId) => ({
          documentId,
          targetDomain: 'JURISPRUDENCIA',
          targetType: 'SENTENCIA',
          targetId: String(sentence.id),
          relationship: 'ASSOCIATED_WITH',
        })),
      });

      const service = new SentenciasService(
        prisma,
        {} as unknown as import('../catalogos/catalogos.service').CatalogosService,
        {} as unknown as import('../estadisticas/eventos-consulta.service').EventosConsultaService,
        new LogsService(prisma),
      );
      await service.setPublicado(sentence.id, true, user.id);
      expect(
        (
          await prisma.sentencia.findUniqueOrThrow({
            where: { id: sentence.id },
          })
        ).publishedAt,
      ).toBeInstanceOf(Date);
      expect(
        (
          await prisma.corpusDocument.findUniqueOrThrow({
            where: { id: general.id },
          })
        ).visibility,
      ).toBe('PUBLIC');
      expect(
        (
          await prisma.corpusDocument.findUniqueOrThrow({
            where: { id: privateDoc.id },
          })
        ).visibility,
      ).toBe('INTERNAL');

      await service.archive(sentence.id, user.id);
      expect(
        (
          await prisma.sentencia.findUniqueOrThrow({
            where: { id: sentence.id },
          })
        ).activo,
      ).toBe(false);
      expect(
        (
          await prisma.corpusDocument.findUniqueOrThrow({
            where: { id: general.id },
          })
        ).visibility,
      ).toBe('INTERNAL');
      expect(
        await prisma.corpusDocument.count({
          where: { id: { in: [general.id, privateDoc.id] } },
        }),
      ).toBe(2);
    },
  );
});

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaService } from '../../src/prisma/prisma.service';

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DEV_DATABASE_URL_MISSING');
  const target = new URL(raw);
  if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') throw new Error('DEV_DATABASE_TARGET_REJECTED');
  const credentialPath = resolve(process.cwd(), '../../_recovery-work/sprint10/acceptance/credentials.json');
  const credentials = JSON.parse(await readFile(credentialPath, 'utf8')) as { localOnly?: boolean; accounts?: Record<string, { email?: string; password?: string }> };
  const roles = ['admin', 'operator', 'reader', 'reviewer', 'jurisprudencia', 'digesto'];
  if (credentials.localOnly !== true || roles.some((role) => !credentials.accounts?.[role]?.password)) throw new Error('DEMO_ACCOUNTS_NOT_SEEDED');
  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    const collection = await prisma.digestoCollection.findFirst({
      where: {
        status: 'ACTIVE',
        memberships: {
          some: {
            document: {
              is: {
                status: 'INDEXED',
                visibility: 'INTERNAL',
                ingestions: {
                  some: { sourceSystem: { is: { code: 'DIGESTO_LOCAL' } } },
                },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' }, select: { id: true, name: true },
    });
    const demoDocument = collection ? await prisma.digestoCollectionMembership.findFirst({
      where: { collectionId: collection.id, document: { is: { status: 'INDEXED', visibility: 'INTERNAL', files: { some: { mimeType: 'application/pdf' } } } } },
      select: { documentId: true, document: { select: { latestExtraction: { select: { pages: { select: { pageNumber: true } } } }, files: { orderBy: { version: 'desc' }, take: 1, select: { sizeBytes: true, pageCount: true } } } } },
    }) : null;
    const jurisprudenceReview = await prisma.corpusDocument.findFirst({
      where: { editorialStatus: 'REVIEW_PENDING', visibility: 'INTERNAL', ingestions: { some: { sourceSystem: { is: { code: 'JURISPRUDENCIA_LOCAL_PDF' } } } }, associations: { some: { reviewStatus: 'REVIEW_PENDING' } } },
      orderBy: { id: 'asc' }, select: { id: true, associations: { where: { reviewStatus: 'REVIEW_PENDING' }, take: 1, select: { id: true } } },
    });
    const classification = await prisma.corpusDocumentClassification.findFirst({
      where: {
        reviewStatus: 'SUGGESTED',
        document: {
          is: {
            visibility: 'INTERNAL',
            ingestions: {
              some: {
                sourceSystem: {
                  is: { code: { in: ['DIGESTO_LOCAL', 'JURISPRUDENCIA_LOCAL_PDF'] } },
                },
              },
            },
          },
        },
      },
      orderBy: { id: 'asc' }, select: { id: true, documentId: true },
    });
    const counts = await prisma.corpusDocument.groupBy({ by: ['status'], where: { visibility: 'INTERNAL' }, _count: { _all: true } });
    console.log(JSON.stringify({
      status: 'SPRINT11_DEMO_READY_READ_ONLY', target: '127.0.0.1:55432/buscador_juridico_civil_dev',
      accounts: roles.map((role) => ({ role, email: credentials.accounts![role].email })),
      digesto: collection ? { collectionId: collection.id, documentId: demoDocument?.documentId ?? null, pages: demoDocument?.document.latestExtraction?.pages.length ?? null, fileSizeBytes: demoDocument?.document.files[0]?.sizeBytes.toString() ?? null } : null,
      jurisprudenceReview: jurisprudenceReview ? { documentId: jurisprudenceReview.id, associationId: jurisprudenceReview.associations[0]?.id } : null,
      classificationReview: classification ? { documentId: classification.documentId, classificationId: classification.id } : null,
      internalStatusCounts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])), sourceRecordsChanged: 0,
      instructions: 'Run the idempotent sprint10-acceptance-seed guard first if local accounts are absent; this command only selects existing INTERNAL records.',
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) main().catch((error) => {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  console.error(/DEV_DATABASE|DEMO_ACCOUNTS/u.test(message) ? message : 'SPRINT11_DEMO_PREPARE_FAILED');
  process.exitCode = 1;
});

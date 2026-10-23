import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';

type Manifest = { workspaceIds: string[]; workspaceCodes: string[]; documentIds: string[]; folderIds: string[]; userIds: number[]; personalOwnerId?: number; personalFilenames?: string[] };

async function main() {
  const root = path.resolve(process.cwd(), '../_recovery-work/sprint1561');
  const manifestNames = [
    'e2e-manifest.json',
    'e2e-manifest-attempt1.json',
    'e2e-manifest-success-attempt1.json',
    'e2e-manifest-isolated-success.json',
  ];
  const manifests: Manifest[] = [];
  for (const name of manifestNames) {
    try {
      manifests.push(JSON.parse(await readFile(path.join(root, name), 'utf8')) as Manifest);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  if (!manifests.length) throw new Error('No Sprint 15.6.1 E2E manifest was found.');
  for (const manifest of manifests) {
    if (
      manifest.workspaceIds.length !== manifest.workspaceCodes.length ||
      !manifest.workspaceCodes.every((code) => code.startsWith('S1561E2E_'))
    )
      throw new Error('Refusing to clean a workspace outside the Sprint 15.6.1 E2E namespace.');
  }
  const workspaceIds = [...new Set(manifests.flatMap((manifest) => manifest.workspaceIds))];
  const workspaceCodes = [...new Set(manifests.flatMap((manifest) => manifest.workspaceCodes))];
  const folderIds = [...new Set(manifests.flatMap((manifest) => manifest.folderIds))];
  const userIds = [...new Set(manifests.flatMap((manifest) => manifest.userIds))];
  const personalOwnerIds = [...new Set(manifests.flatMap((manifest) => manifest.personalOwnerId ? [manifest.personalOwnerId] : []))];
  const personalFilenames = [...new Set(manifests.flatMap((manifest) => manifest.personalFilenames ?? []))];
  const manifestDocumentIds = [...new Set(manifests.flatMap((manifest) => manifest.documentIds))];
  const prisma = new PrismaService();
  const personalDocuments = personalOwnerIds.length && personalFilenames.length
    ? await prisma.workspaceDocument.findMany({
        where: {
          workspaceId: null,
          ownerUserId: { in: personalOwnerIds },
          document: { files: { some: { originalFilename: { in: personalFilenames } } } },
        },
        select: { documentId: true },
      })
    : [];
  const documentIds = [...new Set([...manifestDocumentIds, ...personalDocuments.map((item) => item.documentId)])];
  const fixturePath = path.resolve(process.cwd(), 'scripts/dev/fixtures/corpus/fallo-fixture.pdf');
  const fixtureHash = createHash('sha256').update(await readFile(fixturePath)).digest('hex');
  const auditReferences = [
    ...workspaceIds.map((id) => Prisma.sql`("datosAntes"->>'workspaceId' = ${id} OR "datosDespues"->>'workspaceId' = ${id})`),
    ...folderIds.map((id) => Prisma.sql`("datosAntes"->>'folderId' = ${id} OR "datosDespues"->>'folderId' = ${id})`),
    ...documentIds.map((id) => Prisma.sql`("datosAntes"->>'documentId' = ${id} OR "datosDespues"->>'documentId' = ${id})`),
  ];
  const deletedAuditRows = auditReferences.length
    ? await prisma.$executeRaw(Prisma.sql`DELETE FROM "AccionLog" WHERE ${Prisma.join(auditReferences, ' OR ')}`)
    : 0;
  await prisma.workspaceDocument.deleteMany({
    where: {
      OR: [
        { workspaceId: { in: workspaceIds } },
        { documentId: { in: documentIds } },
      ],
    },
  });
  await prisma.workspaceFolder.deleteMany({
    where: {
      OR: [
        { workspaceId: { in: workspaceIds } },
        { id: { in: folderIds } },
      ],
    },
  });
  if (workspaceIds.length)
    await prisma.documentWorkspace.deleteMany({ where: { id: { in: workspaceIds } } });
  if (documentIds.length)
    await prisma.corpusDocument.deleteMany({ where: { id: { in: documentIds } } });
  if (workspaceCodes.length)
    await prisma.documentDependency.deleteMany({ where: { code: { in: workspaceCodes } } });
  if (userIds.length)
    await prisma.usuario.deleteMany({ where: { id: { in: userIds } } });

  const [remainingUsers, remainingDependencies, remainingWorkspaces, remainingMemberships,
    remainingFolders, remainingGrants, remainingWorkspaceDocuments, remainingCorpusDocuments,
    remainingFiles, remainingExtractions, remainingOcrJobs, remainingAuditRows,
    remainingPages, remainingSearchTokens, fixtureFileReferences] = await Promise.all([
    prisma.usuario.count({ where: { id: { in: userIds } } }),
    prisma.documentDependency.count({ where: { code: { in: workspaceCodes } } }),
    prisma.documentWorkspace.count({ where: { id: { in: workspaceIds } } }),
    prisma.workspaceMembership.count({ where: { OR: [{ workspaceId: { in: workspaceIds } }, { userId: { in: userIds } }] } }),
    prisma.workspaceFolder.count({ where: { OR: [{ workspaceId: { in: workspaceIds } }, { id: { in: folderIds } }] } }),
    prisma.workspaceFolderGrant.count({ where: { folderId: { in: folderIds } } }),
    prisma.workspaceDocument.count({ where: { OR: [{ workspaceId: { in: workspaceIds } }, { documentId: { in: documentIds } }] } }),
    prisma.corpusDocument.count({ where: { id: { in: documentIds } } }),
    prisma.corpusDocumentFile.count({ where: { documentId: { in: documentIds } } }),
    prisma.corpusExtraction.count({ where: { documentId: { in: documentIds } } }),
    prisma.corpusOcrJob.count({ where: { documentId: { in: documentIds } } }),
    auditReferences.length
      ? prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT COUNT(*)::bigint AS count FROM "AccionLog" WHERE ${Prisma.join(auditReferences, ' OR ')}`).then((rows) => Number(rows[0]?.count ?? 0))
      : Promise.resolve(0),
    documentIds.length
      ? prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT COUNT(*)::bigint AS count FROM "CorpusDocumentPage" page JOIN "CorpusExtraction" extraction ON extraction."id" = page."extractionId" WHERE extraction."documentId" IN (${Prisma.join(documentIds.map((id) => Prisma.sql`${id}`))})`).then((rows) => Number(rows[0]?.count ?? 0))
      : Promise.resolve(0),
    documentIds.length
      ? prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT COUNT(*)::bigint AS count FROM "CorpusSearchToken" WHERE "documentId" IN (${Prisma.join(documentIds.map((id) => Prisma.sql`${id}`))})`).then((rows) => Number(rows[0]?.count ?? 0))
      : Promise.resolve(0),
    prisma.corpusDocumentFile.count({ where: { sha256: fixtureHash } }),
  ]);
  const residue = {
    users: remainingUsers,
    dependencies: remainingDependencies,
    workspaces: remainingWorkspaces,
    memberships: remainingMemberships,
    folders: remainingFolders,
    grants: remainingGrants,
    workspaceDocuments: remainingWorkspaceDocuments,
    corpusDocuments: remainingCorpusDocuments,
    files: remainingFiles,
    extractions: remainingExtractions,
    ocrJobs: remainingOcrJobs,
    pages: remainingPages,
    searchTokens: remainingSearchTokens,
    auditRows: remainingAuditRows,
  };
  await prisma.$disconnect();
  if (Object.values(residue).some((count) => count > 0))
    throw new Error(`Sprint 15.6.1 E2E residue remains: ${JSON.stringify(residue)}`);
  console.log(`SPRINT1561_E2E_CLEANUP=${JSON.stringify({ manifestCount: manifests.length, workspaceCount: workspaceIds.length, documentCount: documentIds.length, folderCount: folderIds.length, userCount: userIds.length, deletedAuditRows, fixtureHash, fixtureFileReferences, residue })}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'SPRINT1561_E2E_CLEANUP_FAILED');
  process.exitCode = 1;
});

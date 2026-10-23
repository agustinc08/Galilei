import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';

type WorkspaceManifest = {
  runId: string;
  workspaces: Array<{ id: string; code: string }>;
  status?: string;
};

async function main() {
  const repoRoot = path.resolve(process.cwd(), '..');
  const recoveryRoot = path.join(repoRoot, '_recovery-work', 'sprint154a1');
  const manifestPath = path.join(recoveryRoot, 'workspace-uat-created.json');
  const storageParent = path.resolve(repoRoot, '_dev-corpus-storage-test');
  const storageRoot = path.resolve(storageParent, 'sprint154a1-workspace-uat');
  const manifest = JSON.parse(
    await readFile(manifestPath, 'utf8'),
  ) as WorkspaceManifest;
  if (
    !/^\d{10,}$/u.test(manifest.runId) ||
    !Array.isArray(manifest.workspaces) ||
    manifest.workspaces.length > 2
  )
    throw new Error('E2E_CLEANUP_MANIFEST_INVALID');

  const uniqueIds = new Set<string>();
  const uniqueCodes = new Set<string>();
  for (const workspace of manifest.workspaces) {
    if (
      typeof workspace.id !== 'string' ||
      typeof workspace.code !== 'string' ||
      !new RegExp(`^S151UIE2E_[AB]_${manifest.runId}$`, 'u').test(
        workspace.code,
      ) ||
      uniqueIds.has(workspace.id) ||
      uniqueCodes.has(workspace.code)
    )
      throw new Error('E2E_CLEANUP_SCOPE_INVALID');
    uniqueIds.add(workspace.id);
    uniqueCodes.add(workspace.code);
  }

  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const ids = [...uniqueIds];
    const codes = [...uniqueCodes];
    const workspaces = ids.length
      ? await prisma.documentWorkspace.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            dependencyId: true,
            dependency: { select: { code: true } },
            documents: {
              select: {
                documentId: true,
                document: {
                  select: {
                    documentScope: true,
                    ingestions: {
                      select: { sourceSystem: { select: { code: true } } },
                    },
                  },
                },
              },
            },
          },
        })
      : [];
    for (const workspace of workspaces) {
      const manifestEntry = manifest.workspaces.find(
        (item) => item.id === workspace.id,
      );
      if (!manifestEntry || workspace.dependency.code !== manifestEntry.code)
        throw new Error('E2E_CLEANUP_WORKSPACE_IDENTITY_MISMATCH');
    }

    const documentIds = [
      ...new Set(
        workspaces.flatMap((workspace) =>
          workspace.documents.map((document) => document.documentId),
        ),
      ),
    ];
    if (documentIds.length) {
      const outsideLinks = await prisma.workspaceDocument.findMany({
        where: {
          documentId: { in: documentIds },
          workspaceId: { notIn: ids },
        },
        select: { documentId: true, workspaceId: true },
      });
      if (outsideLinks.length)
        throw new Error('E2E_CLEANUP_DOCUMENT_HAS_EXTERNAL_WORKSPACE_LINK');

      const documents = workspaces.flatMap((workspace) =>
        workspace.documents.map((item) => item.document),
      );
      for (const document of documents) {
        if (
          document.documentScope !== 'PRIVATE_WORKSPACE' ||
          !document.ingestions.length ||
          document.ingestions.some(
            (ingestion) => ingestion.sourceSystem.code !== 'WORKSPACE_UPLOAD',
          )
        )
          throw new Error('E2E_CLEANUP_DOCUMENT_NOT_SYNTHETIC_UPLOAD');
      }
    }

    await prisma.$transaction(async (tx) => {
      if (documentIds.length)
        await tx.corpusDocument.deleteMany({
          where: {
            id: { in: documentIds },
            documentScope: 'PRIVATE_WORKSPACE',
          },
        });
      if (ids.length)
        await tx.documentWorkspace.deleteMany({ where: { id: { in: ids } } });
      if (codes.length)
        await tx.documentDependency.deleteMany({
          where: { code: { in: codes } },
        });
      if (ids.length)
        await tx.$executeRaw`
          DELETE FROM "AccionLog"
           WHERE "entidad" = 'DocumentWorkspace'
             AND COALESCE("datosDespues"->>'workspaceId', "datosAntes"->>'workspaceId')
                 IN (${Prisma.join(ids)})
        `;
    });

    const remaining = await prisma.documentWorkspace.count({
      where: { id: { in: ids } },
    });
    const remainingDocuments = documentIds.length
      ? await prisma.corpusDocument.count({
          where: { id: { in: documentIds } },
        })
      : 0;
    const remainingDependencies = codes.length
      ? await prisma.documentDependency.count({
          where: { code: { in: codes } },
        })
      : 0;
    if (remaining || remainingDocuments || remainingDependencies)
      throw new Error('E2E_CLEANUP_DATABASE_ROWS_REMAIN');

    const resolvedStorage = path.resolve(storageRoot);
    if (!resolvedStorage.startsWith(`${storageParent}${path.sep}`))
      throw new Error('E2E_CLEANUP_STORAGE_PATH_REJECTED');
    await rm(resolvedStorage, { recursive: true, force: true });

    manifest.status = 'CLEANED';
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    console.log(
      JSON.stringify({
        status: 'SPRINT154A1_E2E_CLEANUP_PASS',
        removedWorkspaces: workspaces.length,
        removedDocuments: documentIds.length,
        remainingWorkspaces: remaining,
        remainingDocuments,
        remainingDependencies,
        isolatedStorageRemoved: true,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'E2E_CLEANUP_FAILED');
  process.exitCode = 1;
});

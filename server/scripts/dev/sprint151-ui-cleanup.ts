import { rm } from 'node:fs/promises';
import path from 'node:path';
import { PrismaService } from '../../src/prisma/prisma.service';

const prefix = 'S151UIE2E_';
const storageRoot = path.resolve(
  process.cwd(),
  '../_dev-corpus-storage-test/sprint151-ui',
);
const safeStorageParent = path.resolve(
  process.cwd(),
  '../_dev-corpus-storage-test',
);

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const workspaces = await prisma.documentWorkspace.findMany({
      where: { dependency: { code: { startsWith: prefix } } },
      select: {
        id: true,
        dependencyId: true,
        documents: { select: { documentId: true } },
      },
    });
    const workspaceIds = workspaces.map((workspace) => workspace.id);
    const dependencyIds = workspaces.map((workspace) => workspace.dependencyId);
    const documentIds = [
      ...new Set(
        workspaces.flatMap((workspace) =>
          workspace.documents.map((link) => link.documentId),
        ),
      ),
    ];

    if (workspaceIds.length) {
      await prisma.$executeRaw`
        DELETE FROM "AccionLog"
         WHERE "entidad" = 'DocumentWorkspace'
           AND COALESCE("datosDespues"->>'workspaceId', "datosAntes"->>'workspaceId') = ANY(${workspaceIds}::text[])
      `;
      await prisma.documentWorkspace.deleteMany({
        where: { id: { in: workspaceIds } },
      });
    }
    if (documentIds.length) {
      await prisma.corpusDocument.deleteMany({
        where: {
          id: { in: documentIds },
          documentScope: 'PRIVATE_WORKSPACE',
          workspaceDocuments: { none: {} },
        },
      });
    }
    if (dependencyIds.length)
      await prisma.documentDependency.deleteMany({
        where: { id: { in: dependencyIds } },
      });

    const resolved = path.resolve(storageRoot);
    if (!resolved.startsWith(`${safeStorageParent}${path.sep}`))
      throw new Error(
        'Refusing to remove storage outside the Sprint 15.1 test directory.',
      );
    await rm(resolved, { recursive: true, force: true });
    console.log(
      `SPRINT151_UI_CLEANUP=PASS; syntheticWorkspaces=${workspaceIds.length}; corpusDocuments=${documentIds.length}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(
    `SPRINT151_UI_CLEANUP=FAIL; ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
});

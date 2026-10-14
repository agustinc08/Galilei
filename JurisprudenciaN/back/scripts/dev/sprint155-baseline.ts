import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaService } from '../../src/prisma/prisma.service';

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const [counts] = await prisma.$queryRaw<Array<Record<string, string>>>`
      SELECT
        (SELECT count(*)::text FROM "CorpusSourceSystem") AS sources,
        (SELECT count(*)::text FROM "CorpusDocument") AS documents,
        (SELECT count(*)::text FROM "CorpusDocumentFile") AS files,
        (SELECT count(*)::text FROM "CorpusDocumentPage") AS pages,
        (SELECT count(*)::text FROM "CorpusIngestionRecord") AS ingestions,
        (SELECT count(*)::text FROM "CorpusDocument" WHERE "documentScope" = 'PRIVATE_WORKSPACE') AS privateDocuments,
        (SELECT count(*)::text FROM "WorkspaceDocument") AS workspaceDocuments,
        (SELECT count(*)::text FROM "DocumentWorkspace") AS workspaces,
        (SELECT count(*)::text FROM "WorkspaceMembership" WHERE "active" = true) AS activeMemberships,
        (SELECT count(*)::text FROM "CorpusSearchToken") AS tokens,
        (SELECT "isReady"::text FROM "CorpusSearchTokenProjectionControl" WHERE "singleton" = true) AS projectionReady
    `;
    const [documentStates, extractionStates, ocrStates, fileTypes] = await Promise.all([
      prisma.$queryRaw<Array<{ status: string; scope: string; count: string }>>`
        SELECT "status", "documentScope"::text AS scope, count(*)::text AS count
          FROM "CorpusDocument" GROUP BY "status", "documentScope" ORDER BY "status", "documentScope"
      `,
      prisma.$queryRaw<Array<{ status: string; count: string }>>`
        SELECT "status", count(*)::text AS count FROM "CorpusExtraction" GROUP BY "status" ORDER BY "status"
      `,
      prisma.$queryRaw<Array<{ status: string; count: string }>>`
        SELECT "status", count(*)::text AS count FROM "CorpusOcrJob" GROUP BY "status" ORDER BY "status"
      `,
      prisma.$queryRaw<Array<{ mimeType: string; count: string }>>`
        SELECT lower(btrim(split_part("mimeType", ';', 1))) AS "mimeType", count(*)::text AS count
          FROM "CorpusDocumentFile" GROUP BY 1 ORDER BY 1
      `,
    ]);
    const report = {
      generatedAt: new Date().toISOString(),
      target: 'bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev',
      counts,
      processing: { documentStates, extractionStates, ocrStates },
      fileTypes,
    };
    const recoveryRoot = path.resolve(process.cwd(), '../../_recovery-work/sprint155');
    await mkdir(recoveryRoot, { recursive: true });
    await writeFile(path.join(recoveryRoot, 'baseline.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'SPRINT155_BASELINE_FAILED');
  process.exitCode = 1;
});

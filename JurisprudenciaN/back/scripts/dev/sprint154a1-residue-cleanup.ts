import { createHash } from 'node:crypto';
import { access, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { PrismaService } from '../../src/prisma/prisma.service';

const targetFilenames = [
  'sprint154a-fixture.rtf',
  'sprint154a-fixture.docx',
  'sprint154a-fixture.odt',
  'sprint154a1-fixture.doc',
];
const fileDateFloor = new Date('2026-10-14T00:00:00.000Z');

async function main() {
  if (!process.env.DATABASE_URL)
    throw new Error('Run through the DEV database guard.');
  const target = new URL(process.env.DATABASE_URL);
  if (
    target.protocol !== 'postgresql:' ||
    target.hostname !== '127.0.0.1' ||
    target.port !== '55432' ||
    target.pathname !== '/buscador_juridico_civil_dev' ||
    target.username !== 'bjc_dev'
  )
    throw new Error('SPRINT154A1_DEV_TARGET_REJECTED');

  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const identity = await prisma.$queryRaw<
      Array<{
        database: string;
        role: string;
        host: string;
        port: number;
      }>
    >`
      SELECT current_database() AS database,
             current_user AS role,
             inet_server_addr()::text AS host,
             inet_server_port() AS port
    `;
    const live = identity[0];
    if (
      live?.database !== 'buscador_juridico_civil_dev' ||
      live.role !== 'bjc_dev' ||
      live.host.replace(/\/\d+$/u, '') !== '127.0.0.1' ||
      Number(live.port) !== 55432
    )
      throw new Error('SPRINT154A1_LIVE_DB_IDENTITY_REJECTED');

    const fixture = await readFile(
      path.resolve(
        __dirname,
        '../../src/corpus/fixtures/sprint154a1-golden.doc',
      ),
    );
    const fixtureSha = createHash('sha256').update(fixture).digest('hex');
    const candidates = await prisma.corpusDocument.findMany({
      where: {
        documentScope: 'PRIVATE_WORKSPACE',
        createdAt: { gte: fileDateFloor },
        workspaceDocuments: { none: {} },
        files: { some: { originalFilename: { in: targetFilenames } } },
        ingestions: {
          some: { sourceSystem: { is: { code: 'WORKSPACE_UPLOAD' } } },
        },
      },
      select: {
        id: true,
        createdAt: true,
        files: {
          select: {
            originalFilename: true,
            storageKey: true,
            sha256: true,
          },
        },
        ingestions: {
          select: { sourceSystem: { select: { code: true } } },
        },
        latestExtraction: { select: { text: true } },
        workspaceDocuments: { select: { id: true } },
      },
    });

    const matched = candidates.filter((document) => {
      if (
        document.workspaceDocuments.length ||
        !document.ingestions.length ||
        document.ingestions.some(
          (ingestion) => ingestion.sourceSystem.code !== 'WORKSPACE_UPLOAD',
        )
      )
        return false;
      const files = document.files.filter((file) =>
        targetFilenames.includes(file.originalFilename),
      );
      if (files.length !== 1) return false;
      const file = files[0];
      const text =
        document.latestExtraction?.text.toLocaleLowerCase('es') ?? '';
      if (file.originalFilename === 'sprint154a1-fixture.doc')
        return file.sha256 === fixtureSha && text.includes('12345/2026');
      return text.includes('sprint154amanual');
    });

    const duplicateNames = targetFilenames.filter(
      (filename) =>
        matched.filter((document) =>
          document.files.some((file) => file.originalFilename === filename),
        ).length > 1,
    );
    if (duplicateNames.length)
      throw new Error(
        `SPRINT154A1_RESIDUE_DUPLICATE_CANDIDATES:${duplicateNames.join(',')}`,
      );

    const report = {
      status: process.argv.includes('--apply')
        ? 'SPRINT154A1_RESIDUE_CLEANUP'
        : 'SPRINT154A1_RESIDUE_AUDIT',
      target: {
        endpoint: '127.0.0.1:55432',
        database: live.database,
        role: live.role,
      },
      candidates: matched.map((document) => ({
        id: document.id,
        createdAt: document.createdAt.toISOString(),
        file: document.files[0].originalFilename,
        sha256: document.files[0].sha256,
      })),
    };
    if (!process.argv.includes('--apply')) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    const deleted = await prisma.$transaction((tx) =>
      tx.corpusDocument.deleteMany({
        where: {
          id: { in: matched.map((document) => document.id) },
          documentScope: 'PRIVATE_WORKSPACE',
        },
      }),
    );
    if (deleted.count !== matched.length)
      throw new Error('SPRINT154A1_RESIDUE_DELETE_COUNT_MISMATCH');

    const storageRoot = path.resolve(
      process.cwd(),
      '../../_dev-corpus-storage-test/sprint15-workspaces',
    );
    const storageResults: Array<{ key: string; status: string }> = [];
    for (const key of new Set(
      matched.flatMap((document) =>
        document.files.map((file) => file.storageKey),
      ),
    )) {
      if (!/^[a-f0-9]{2}\/[a-f0-9]{64}\.[a-z0-9]{1,10}$/u.test(key))
        throw new Error('SPRINT154A1_STORAGE_KEY_REJECTED');
      const references = await prisma.corpusDocumentFile.count({
        where: { storageKey: key },
      });
      if (references) {
        storageResults.push({ key, status: 'RETAINED_SHARED_REFERENCE' });
        continue;
      }
      const targetPath = path.resolve(storageRoot, key);
      if (!targetPath.startsWith(`${storageRoot}${path.sep}`))
        throw new Error('SPRINT154A1_STORAGE_PATH_REJECTED');
      const matchingFile = matched
        .flatMap((document) => document.files)
        .find((file) => file.storageKey === key)!;
      try {
        await access(targetPath);
        const content = await readFile(targetPath);
        const actualSha = createHash('sha256').update(content).digest('hex');
        if (actualSha !== matchingFile.sha256)
          throw new Error('SPRINT154A1_STORAGE_SHA_MISMATCH');
        await rm(targetPath, { force: true });
        storageResults.push({ key, status: 'REMOVED_UNREFERENCED_SYNTHETIC' });
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          storageResults.push({ key, status: 'ALREADY_ABSENT' });
          continue;
        }
        throw error;
      }
    }
    console.log(
      JSON.stringify(
        {
          ...report,
          status: 'SPRINT154A1_RESIDUE_CLEANUP_PASS',
          deletedDocuments: deleted.count,
          storageResults,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : 'SPRINT154A1_RESIDUE_CLEANUP_FAILED',
  );
  process.exitCode = 1;
});

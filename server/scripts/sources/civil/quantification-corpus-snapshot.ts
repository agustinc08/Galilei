import { PrismaService } from '../../../src/prisma/prisma.service';

async function main() {
  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    const documents = await prisma.corpusDocument.findMany({
      where: {
        OR: [
          { court: { contains: 'civil', mode: 'insensitive' } },
          { chamber: { contains: 'civil', mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        title: true,
        court: true,
        chamber: true,
        instance: true,
        caseNumber: true,
        decisionDate: true,
        status: true,
        files: { select: { id: true } },
        ingestions: { select: { sourceSystem: { select: { code: true } } } },
      },
      orderBy: [{ decisionDate: 'asc' }, { id: 'asc' }],
    });
    console.log(
      JSON.stringify(
        documents.map((document) => ({
          id: document.id,
          title: document.title,
          court: document.court,
          chamber: document.chamber,
          instance: document.instance,
          caseNumber: document.caseNumber,
          decisionDate:
            document.decisionDate?.toISOString().slice(0, 10) ?? null,
          status: document.status,
          fileCount: document.files.length,
          sourceCodes: [
            ...new Set(
              document.ingestions.map((item) => item.sourceSystem.code),
            ),
          ].sort(),
        })),
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

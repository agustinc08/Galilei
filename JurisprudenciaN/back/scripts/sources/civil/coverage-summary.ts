import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaService } from '../../../src/prisma/prisma.service';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

function readAlternativeRecoverySummary(): Record<string, unknown> | null {
  const summaryPath = path.join(ROOT, '_recovery-work', 'sprint147', 'missing-manifest-summary.json');
  if (!fs.existsSync(summaryPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    return { status: 'CHECKPOINT_READ_ERROR', message: error instanceof Error ? error.message : String(error) };
  }
}

function normalize(value: string | null | undefined): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

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
        court: true,
        chamber: true,
        instance: true,
        caseNumber: true,
        decisionDate: true,
        status: true,
        files: { select: { id: true } },
        ingestions: { select: { sourceSystem: { select: { code: true } } } },
      },
    });
    const cijDocketMatches = await prisma.corpusDocument.findMany({
      where: { caseNumber: { contains: '24.971/2024', mode: 'insensitive' } },
      select: { id: true, court: true, caseNumber: true, decisionDate: true, status: true },
      take: 10,
    });

    const grouped = new Map<string, { year: string; instance: string; known: number; downloaded: number; indexed: number; ocrRequired: number; pending: number; sources: Set<string> }>();
    const byCourt = new Map<string, number>();
    let chamberKnown = 0;
    let firstInstanceKnown = 0;
    let oldest: string | null = null;
    let newest: string | null = null;
    for (const document of documents) {
      const court = normalize(document.court);
      const chamber = normalize(document.chamber);
      const label = `${court} ${chamber}`;
      const isChamber = /CAMARA NACIONAL DE APELACIONES EN LO CIVIL\b/.test(label)
        && !/CIVIL Y COMERCIAL FEDERAL/.test(label);
      const isFirstInstance = /JUZGADO .*\bCIVIL\b/.test(label) || /^JUZGADO CIVIL\b/.test(label);
      if (!isChamber && !isFirstInstance) continue;
      const instance = isChamber ? 'CAMARA' : 'JUZGADO';
      const year = document.decisionDate ? String(document.decisionDate.getUTCFullYear()) : 'SIN_FECHA';
      if (document.decisionDate) {
        const date = document.decisionDate.toISOString().slice(0, 10);
        if (!oldest || date < oldest) oldest = date;
        if (!newest || date > newest) newest = date;
      }
      if (isChamber) chamberKnown += 1;
      if (isFirstInstance) firstInstanceKnown += 1;
      const key = `${year}|${instance}`;
      const row = grouped.get(key) || { year, instance, known: 0, downloaded: 0, indexed: 0, ocrRequired: 0, pending: 0, sources: new Set<string>() };
      row.known += 1;
      if (document.files.length > 0) row.downloaded += 1;
      if (document.status === 'INDEXED') row.indexed += 1;
      else if (document.status === 'OCR_REQUIRED') row.ocrRequired += 1;
      else row.pending += 1;
      for (const ingestion of document.ingestions) row.sources.add(ingestion.sourceSystem.code);
      grouped.set(key, row);
      const courtKey = document.court || document.chamber || '(tribunal sin dato)';
      byCourt.set(courtKey, (byCourt.get(courtKey) || 0) + 1);
    }
    const years = [...grouped.values()].sort((a, b) => a.year.localeCompare(b.year) || a.instance.localeCompare(b.instance))
      .map(row => ({ ...row, sources: [...row.sources].sort() }));
    console.log(`CIVIL_CORPUS_COVERAGE=${JSON.stringify({
      targetCorpusDocuments: chamberKnown + firstInstanceKnown,
      cijLeadDocketMatches: cijDocketMatches.map(document => ({
        court: document.court,
        caseNumber: document.caseNumber,
        decisionDate: document.decisionDate?.toISOString().slice(0, 10) ?? null,
        status: document.status,
      })),
      chamberKnown,
      firstInstanceKnown,
      oldestDecisionDate: oldest,
      newestDecisionDate: newest,
      byYearInstance: years,
      byCourt: [...byCourt.entries()].map(([court, known]) => ({ court, known })).sort((a, b) => a.court.localeCompare(b.court)),
    })}`);
    console.log(`CIVIL_ALTERNATIVE_RECOVERY=${JSON.stringify(readAlternativeRecoverySummary())}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

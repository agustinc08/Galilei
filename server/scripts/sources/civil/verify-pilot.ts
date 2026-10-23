import { PrismaService } from '../../../src/prisma/prisma.service';
import { CorpusSearchSourceAdapter } from '../../../src/corpus/corpus-search.adapter';
import { CorpusDocumentAccessService } from '../../../src/corpus/corpus-document-access.service';
import { parseSearchQuery } from '../../../src/busqueda/utils/search-parser';

async function main() {
  const prisma = new PrismaService();
  const adapter = new CorpusSearchSourceAdapter(process.env.DATABASE_URL!);
  try {
    await prisma.$connect();
    const source = await prisma.corpusSourceSystem.findUnique({ where: { code: 'CSJN_TFN_HISTORICAL' }, select: { id: true, code: true, name: true } });
    if (!source) throw new Error('CSJN_TFN_HISTORICAL no existe en DEV.');
    const rows = await prisma.corpusIngestionRecord.findMany({
      where: { sourceSystemId: source.id },
      select: { status: true, checksum: true, document: { select: {
        id: true, title: true, status: true, visibility: true,
        latestExtraction: { select: { status: true, text: true, pages: { select: { pageNumber: true, text: true } } } },
      } } },
    });
    const searchable = rows.find((r) => r.document.latestExtraction?.text.trim() && r.document.latestExtraction.pages.length);
    if (!searchable?.document.latestExtraction) throw new Error('No hay documento Civil extraído para el smoke.');
    const page = searchable.document.latestExtraction.pages[0];
    const terms = [...new Set(page.text.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').match(/[\p{L}]{6,}/gu) || [])].sort((a, b) => b.length - a.length);
    const term = terms[0];
    if (!term) throw new Error('La primera página no contiene término indexable.');
    const title = searchable.document.title.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
    const probes = [
      { kind: 'TITLE_AND_TERM', query: `caratula:"${title}" AND ${term}` },
      { kind: 'TERM', query: term },
      { kind: 'TITLE', query: `caratula:"${title}"` },
    ];
    const checks: Array<{ kind: string; total: number; found: boolean; elapsedMs: number; hit: any }> = [];
    for (const probe of probes) {
      const started = Date.now();
      const found = await adapter.search(parseSearchQuery(probe.query), { visibility: 'INTERNAL', dialect: 'modern', publicationPolicy: 'published-active-only', page: 1, pageSize: 100 });
      const hit = found.results.find((item) => item.sourceId === searchable.document.id);
      checks.push({ kind: probe.kind, total: found.total, found: !!hit, elapsedMs: Date.now() - started, hit });
      if (hit) break;
    }
    const successful = checks.find((check) => check.found);
    if (!successful?.hit) throw new Error(`Search smoke no encontró el documento; probes=${JSON.stringify(checks.map(({kind,total})=>({kind,total})))}`);
    const access = new CorpusDocumentAccessService(prisma);
    const [metadata, file, matches] = await Promise.all([
      access.metadata(searchable.document.id, 'INTERNAL', Number(successful.hit.metadata.pageNumber ?? page.pageNumber)),
      access.file(searchable.document.id, 'INTERNAL'),
      access.matches(searchable.document.id, 'INTERNAL', term),
    ]);
    if (!metadata.selectedPage || file.content.length === 0) throw new Error('Viewer metadata/file check failed.');
    const ids = new Set(rows.map((r) => r.document.id));
    const result = {
      status: 'CIVIL_PILOT_VERIFIED', source: source.code, sourceName: source.name,
      ingestionRecords: rows.length, uniqueDocuments: ids.size,
      ingestionStatuses: Object.entries(rows.reduce<Record<string, number>>((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {})),
      indexedDocuments: new Set(rows.filter((r) => r.document.status === 'INDEXED').map((r) => r.document.id)).size,
      extractedDocuments: new Set(rows.filter((r) => !!r.document.latestExtraction?.text.trim()).map((r) => r.document.id)).size,
      ocrRequired: rows.filter((r) => r.document.latestExtraction?.status === 'OCR_REQUIRED').length,
      invalidPdf: rows.filter((r) => r.document.latestExtraction?.status === 'INVALID_PDF').length,
      pages: new Set(rows.flatMap((r) => r.document.latestExtraction?.pages.map((p) => `${r.document.id}:${p.pageNumber}`) || [])).size,
      textCharacters: rows.reduce((n, r) => n + (r.document.latestExtraction?.text.length || 0), 0),
      contentHashes: new Set(rows.map((r) => r.checksum)).size,
      internalVisibilityOnly: rows.every((r) => r.document.visibility === 'INTERNAL'),
      searchViewer: { probes: checks.map(({kind,total,found,elapsedMs})=>({kind,total,found,elapsedMs})), page: metadata.selectedPage.pageNumber, matches: matches.total, fileBytes: file.content.length },
    };
    console.log(JSON.stringify(result, null, 2));
  } finally { await adapter.close(); await prisma.$disconnect(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });

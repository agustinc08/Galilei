import { PrismaService } from '../../../src/prisma/prisma.service';
import { CorpusSearchSourceAdapter } from '../../../src/corpus/corpus-search.adapter';
import { CorpusDocumentAccessService } from '../../../src/corpus/corpus-document-access.service';
import { parseSearchQuery } from '../../../src/busqueda/utils/search-parser';

async function main() {
  const externalId = process.env.BJC_CIVIL_CURRENT_EXTERNAL_ID;
  const caseNumber = process.env.BJC_CIVIL_CURRENT_CASE_NUMBER;
  if (!externalId || !caseNumber) throw new Error('Falta externalId o expediente del feed Civil actual.');
  const prisma = new PrismaService();
  const adapter = new CorpusSearchSourceAdapter(process.env.DATABASE_URL!);
  try {
    await prisma.$connect();
    const source = await prisma.corpusSourceSystem.findUnique({ where: { code: 'TFN_ACTUAL_CIVIL' }, select: { id: true, code: true } });
    if (!source) throw new Error('TFN_ACTUAL_CIVIL no existe en DEV.');
    const record = await prisma.corpusIngestionRecord.findFirst({
      where: { sourceSystemId: source.id, externalId },
      select: { status: true, checksum: true, document: { select: {
        id: true, title: true, status: true, visibility: true,
        latestExtraction: { select: { status: true, text: true, pages: { select: { pageNumber: true, text: true } } } },
      } } },
    });
    if (!record) throw new Error('No se encontró el registro de ingesta por externalId en DEV.');
    const doc = record.document;
    let searchFound = false;
    let searchTotal = 0;
    let hit: any = null;
    let searchMethod = 'NONE';
    let searchMatchTerm: string | null = null;
    if (doc.status === 'INDEXED' && doc.latestExtraction?.text.trim()) {
      const candidates = [...new Set(doc.latestExtraction.pages.flatMap(page =>
        page.text.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').match(/[\p{L}]{8,}/gu) || [],
      ).map(term => term.toLowerCase()).filter(term => !['sentencia','expediente','juzgado','tribunal','secretaria','apelaciones','nacional'].includes(term)))].sort((a,b) => b.length-a.length).slice(0,12);
      for (const term of candidates) {
        const result = await adapter.search(parseSearchQuery(term), {
          visibility: 'INTERNAL', dialect: 'modern', publicationPolicy: 'published-active-only',
          page: 1, pageSize: 100, sourceSystems: ['CORPUS'],
        });
        hit = result.results.find(item => item.sourceId === doc.id) || null;
        if (hit) {
          searchFound = true;
          searchTotal = result.total;
          searchMethod = 'TEXT_TERM';
          searchMatchTerm = term;
          break;
        }
      }
      if (!searchFound) {
        const result = await adapter.search(parseSearchQuery(`expediente:"${caseNumber.replace(/"/g, '\\"')}"`), {
          visibility: 'INTERNAL', dialect: 'modern', publicationPolicy: 'published-active-only',
          page: 1, pageSize: 100, sourceSystems: ['CORPUS'],
        });
        searchTotal = result.total;
        hit = result.results.find(item => item.sourceId === doc.id) || null;
        searchFound = !!hit;
        searchMethod = 'STRUCTURED_CASE_NUMBER';
      }
    }
    const extraction = doc.latestExtraction;
    const access = new CorpusDocumentAccessService(prisma);
    const pageNumber = Number(hit?.metadata?.pageNumber ?? extraction?.pages?.[0]?.pageNumber ?? 1);
    const [metadata, file, matches] = await Promise.all([
      access.metadata(doc.id, 'INTERNAL', pageNumber),
      access.file(doc.id, 'INTERNAL'),
      caseNumber ? access.matches(doc.id, 'INTERNAL', searchMatchTerm || caseNumber) : Promise.resolve({ total: 0 }),
    ]);
    if (!metadata.selectedPage || file.content.length === 0) throw new Error('Viewer metadata/file check failed.');
    if (doc.status === 'INDEXED' && !searchFound) throw new Error('El documento está INDEXED pero no aparece en Search V2 por expediente.');
    const result = {
      source: source.code,
      externalId,
      corpusDocumentId: doc.id,
      ingestionStatus: record.status,
      documentStatus: doc.status,
      extractionStatus: extraction?.status ?? 'MISSING',
      extractedPages: extraction?.pages.length ?? 0,
      textCharacters: extraction?.text.length ?? 0,
      checksum: record.checksum,
      searchFound,
      searchMethod,
      searchTotal,
      textMatches: matches.total,
      viewerPage: metadata.selectedPage.pageNumber,
      viewerMatches: matches.total,
      fileBytes: file.content.length,
      outcome: doc.status === 'INDEXED' && searchFound ? 'INDEXED' : doc.status === 'OCR_REQUIRED' ? 'OCR_REQUIRED' : 'PARTIAL',
    };
    console.log(`CURRENT_CIVIL_VERIFY=${JSON.stringify(result)}`);
  } finally { await adapter.close(); await prisma.$disconnect(); }
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

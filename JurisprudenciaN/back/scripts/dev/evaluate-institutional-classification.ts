import { normalizeSearchText } from '../../src/busqueda/utils/search-normalizer';
import { PrismaService } from '../../src/prisma/prisma.service';

async function main() {
  if (!process.env.DATABASE_URL)
    throw new Error('Run through the DEV database guard.');
  const args = process.env.BJC_INSTITUTIONAL_ARGS
    ? (JSON.parse(process.env.BJC_INSTITUTIONAL_ARGS) as string[])
    : [];
  const runId = args[0];
  if (!runId)
    throw new Error('Usage: institutional-classification-evaluate <runId>');
  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    const sample = await prisma.corpusImportRunItem.findMany({
      where: {
        runId,
        status: { in: ['INDEXED', 'OCR_REQUIRED'] },
        documentId: { not: null },
      },
      orderBy: { itemKey: 'asc' },
      take: 100,
      select: { itemKey: true, documentId: true },
    });
    const documentIds = sample.flatMap((item) =>
      item.documentId ? [item.documentId] : [],
    );
    const [documents, suggestions, exactLinks, approvedMetadata] =
      await Promise.all([
        prisma.corpusDocument.findMany({
          where: { id: { in: documentIds } },
          select: { id: true, searchText: true },
        }),
        prisma.corpusDocumentClassification.findMany({
          where: { documentId: { in: documentIds }, origin: 'RULE' },
          select: { documentId: true, evidence: true },
        }),
        prisma.corpusDocumentLink.count({
          where: {
            documentId: { in: documentIds },
            targetDomain: 'JURISPRUDENCIA',
            targetType: 'SENTENCIA',
            metadata: { path: ['confidence'], equals: 'EXACT' },
          },
        }),
        prisma.corpusDocumentClassification.count({
          where: {
            documentId: { in: documentIds },
            origin: 'EXISTING_METADATA',
            reviewStatus: 'APPROVED',
          },
        }),
      ]);
    const textById = new Map(
      documents.map((document) => [
        document.id,
        normalizeSearchText(document.searchText),
      ]),
    );
    let evidenceTerms = 0;
    let evidenceTermsPresent = 0;
    for (const suggestion of suggestions) {
      const terms = (suggestion.evidence as { matchedTerms?: unknown } | null)
        ?.matchedTerms;
      if (!Array.isArray(terms)) continue;
      const text = textById.get(suggestion.documentId) ?? '';
      for (const term of terms) {
        if (typeof term !== 'string') continue;
        evidenceTerms += 1;
        if (text.includes(normalizeSearchText(term))) evidenceTermsPresent += 1;
      }
    }
    console.log(
      JSON.stringify(
        {
          status: 'CLASSIFICATION_SAMPLE_EVALUATED',
          runId,
          sampleMethod:
            'first 100 eligible run items ordered by SHA-256 itemKey ascending',
          sampleDocuments: sample.length,
          ruleSuggestedDocuments: new Set(
            suggestions.map((suggestion) => suggestion.documentId),
          ).size,
          ruleSuggestionRows: suggestions.length,
          exactJurisprudenciaGroundTruthLinks: exactLinks,
          approvedExistingMetadataLabels: approvedMetadata,
          persistedEvidenceTerms: evidenceTerms,
          evidenceTermsPresentInSearchProjection: evidenceTermsPresent,
          semanticPrecisionMeasured: exactLinks + approvedMetadata > 0,
          semanticPrecisionLimitation:
            exactLinks + approvedMetadata > 0
              ? null
              : 'No approved source labels exist in this sample; rule-match consistency is not legal-category precision.',
          firstSampleKey: sample[0]?.itemKey ?? null,
          lastSampleKey: sample.at(-1)?.itemKey ?? null,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });

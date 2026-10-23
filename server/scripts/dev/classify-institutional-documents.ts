import { normalizeSearchText } from '../../src/busqueda/utils/search-normalizer';
import { PrismaService } from '../../src/prisma/prisma.service';

const rules = [
  ['Responsabilidad civil', ['responsabilidad civil', 'deber de reparar']],
  ['Daños', ['daño moral', 'daños y perjuicios', 'daño patrimonial']],
  ['Contratos', ['contrato', 'incumplimiento contractual']],
  ['Familia', ['alimentos', 'responsabilidad parental', 'divorcio']],
  ['Sucesiones', ['sucesión', 'heredero', 'herencia']],
  ['Honorarios', ['honorarios profesionales', 'regulación de honorarios']],
  [
    'Procesal',
    ['carga de la prueba', 'medida cautelar', 'competencia judicial'],
  ],
  ['Prescripción', ['prescripción liberatoria', 'plazo de prescripción']],
  ['Locaciones', ['locación', 'alquiler', 'desalojo']],
  ['Propiedad', ['dominio', 'propiedad horizontal', 'reivindicación']],
] as const;

async function main() {
  const args = process.env.BJC_INSTITUTIONAL_ARGS
    ? (JSON.parse(process.env.BJC_INSTITUTIONAL_ARGS) as string[])
    : process.argv.slice(2);
  const runIndex = args.indexOf('--run');
  const limitIndex = args.indexOf('--limit');
  const runId = runIndex >= 0 ? args[runIndex + 1] : undefined;
  const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : undefined;
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1))
    throw new Error('--limit debe ser un entero positivo.');
  const prisma = new PrismaService();
  const counts = {
    documents: 0,
    existingApproved: 0,
    ruleSuggested: 0,
    unclassified: 0,
  };
  try {
    await prisma.$connect();
    const items = runId
      ? await prisma.corpusImportRunItem.findMany({
          where: {
            runId,
            status: { in: ['INDEXED', 'OCR_REQUIRED'] },
            documentId: { not: null },
          },
          select: { documentId: true },
          distinct: ['documentId'],
          take: limit,
        })
      : await prisma.corpusImportRunItem.findMany({
          where: {
            status: { in: ['INDEXED', 'OCR_REQUIRED'] },
            documentId: { not: null },
          },
          select: { documentId: true },
          distinct: ['documentId'],
          take: limit,
        });
    for (const item of items) {
      if (!item.documentId) continue;
      const document = await prisma.corpusDocument.findUnique({
        where: { id: item.documentId },
        select: {
          id: true,
          searchText: true,
          links: {
            where: { targetDomain: 'JURISPRUDENCIA', targetType: 'SENTENCIA' },
            select: { targetId: true, metadata: true },
          },
        },
      });
      if (!document) continue;
      counts.documents += 1;
      let added = 0;
      const sentenceIds = document.links
        .filter(
          (link) =>
            (link.metadata as { confidence?: string } | null)?.confidence ===
            'EXACT',
        )
        .map((link) => Number(link.targetId))
        .filter(Number.isSafeInteger);
      const sentences = sentenceIds.length
        ? await prisma.sentencia.findMany({
            where: { id: { in: sentenceIds } },
            select: {
              caratula: true,
              fecha: true,
              expediente: true,
              tribunalOrigen: true,
              sala: true,
              tipoFallo: true,
              sumarios: { select: { tema: true } },
            },
          })
        : [];
      const metadataValues = new Map<
        string,
        { category: string; value: string }
      >();
      for (const sentence of sentences) {
        add(metadataValues, 'CARATULA', sentence.caratula);
        add(
          metadataValues,
          'FECHA',
          sentence.fecha?.toISOString().slice(0, 10),
        );
        add(metadataValues, 'EXPEDIENTE', sentence.expediente);
        add(metadataValues, 'TRIBUNAL', sentence.tribunalOrigen);
        add(metadataValues, 'SALA', sentence.sala);
        add(metadataValues, 'TIPO', sentence.tipoFallo);
        for (const sumario of sentence.sumarios)
          add(metadataValues, 'TEMA', sumario.tema);
      }
      for (const { category, value } of metadataValues.values()) {
        await prisma.corpusDocumentClassification.upsert({
          where: {
            documentId_category_value_origin: {
              documentId: document.id,
              category,
              value,
              origin: 'EXISTING_METADATA',
            },
          },
          create: {
            documentId: document.id,
            category,
            value,
            origin: 'EXISTING_METADATA',
            confidence: 1,
            reviewStatus: 'APPROVED',
            evidence: { source: 'EXACT_JURISPRUDENCIA_LINK' },
          },
          update: {
            confidence: 1,
            reviewStatus: 'APPROVED',
            evidence: { source: 'EXACT_JURISPRUDENCIA_LINK' },
          },
        });
        counts.existingApproved += 1;
        added += 1;
      }
      const normalized = normalizeSearchText(document.searchText);
      for (const [value, terms] of rules) {
        const evidence = terms.filter((term) =>
          normalized.includes(normalizeSearchText(term)),
        );
        if (!evidence.length) continue;
        await prisma.corpusDocumentClassification.upsert({
          where: {
            documentId_category_value_origin: {
              documentId: document.id,
              category: 'TEMA',
              value,
              origin: 'RULE',
            },
          },
          create: {
            documentId: document.id,
            category: 'TEMA',
            value,
            origin: 'RULE',
            confidence: evidence.length > 1 ? 0.86 : 0.72,
            reviewStatus: 'SUGGESTED',
            evidence: { matchedTerms: evidence },
          },
          update: {
            confidence: evidence.length > 1 ? 0.86 : 0.72,
            evidence: { matchedTerms: evidence },
          },
        });
        counts.ruleSuggested += 1;
        added += 1;
      }
      if (!added) counts.unclassified += 1;
    }
    console.log(
      JSON.stringify(
        { status: 'CLASSIFICATION_COMPLETE', runId: runId ?? null, ...counts },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

function add(
  values: Map<string, { category: string; value: string }>,
  category: string,
  raw: string | null | undefined,
) {
  const value = raw?.trim();
  if (value) values.set(`${category}\0${value}`, { category, value });
}

if (require.main === module)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });

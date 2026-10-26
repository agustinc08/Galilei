export type IdentifiedCitation = {
  rawCitation: string;
  identifier: string;
  normalizedIdentifier: string;
  identifierType: 'EXPEDIENTE' | 'NUMERO_SENTENCIA';
  extractionMethod: 'explicit-case-identifier-v1';
};

export type CitationSourceIdentity = {
  expediente?: string | null;
  numeroSentencia?: string | null;
};

const PATTERNS: Array<{
  type: IdentifiedCitation['identifierType'];
  expression: RegExp;
}> = [
  {
    type: 'EXPEDIENTE',
    expression:
      /\bexp(?:ediente|te)?(?:\.|\b)\s*(?:n(?:ro|[º°.]?)\.?\s*)?((?:[A-Z]{1,5}[-\s]?)?\d[\d.]*\/\d{2,4})\b/giu,
  },
  {
    type: 'NUMERO_SENTENCIA',
    expression:
      /\b(?:sentencia|fallo)\s*(?:n(?:ro|[º°.]?)\.?\s*)?(\d{1,6}\/\d{2,4})\b/giu,
  },
];

const SOURCE_IDENTIFIER_PATTERN = /(?:[A-Z]{1,5}[-\s]?)?\d[\d.]*\/\d{2,4}/giu;

/** Extract only explicit, year-qualified case identifiers; no fuzzy matching. */
export function extractIdentifiedCitations(
  text: string,
  sourceIdentity: CitationSourceIdentity = {},
): IdentifiedCitation[] {
  const sourceExpedientes = identifiersFromSource(sourceIdentity.expediente);
  const sourceNumbers = identifiersFromSource(sourceIdentity.numeroSentencia);
  const found = new Map<string, IdentifiedCitation>();
  for (const pattern of PATTERNS) {
    pattern.expression.lastIndex = 0;
    for (const match of text.matchAll(pattern.expression)) {
      const identifier = match[1]?.trim();
      const rawCitation = match[0]?.trim();
      if (!identifier || !rawCitation) continue;
      const normalizedIdentifier = identifier
        .normalize('NFKC')
        .replace(/\s+/gu, '')
        .toLocaleUpperCase('es-AR');
      const sourceIdentifiers =
        pattern.type === 'EXPEDIENTE' ? sourceExpedientes : sourceNumbers;
      if (
        identifierVariants(normalizedIdentifier).some((value) =>
          sourceIdentifiers.has(value),
        )
      ) {
        continue;
      }
      const key = `${pattern.type}:${normalizedIdentifier}`;
      if (!found.has(key)) {
        found.set(key, {
          rawCitation,
          identifier,
          normalizedIdentifier,
          identifierType: pattern.type,
          extractionMethod: 'explicit-case-identifier-v1',
        });
      }
    }
  }
  return [...found.values()];
}

function identifiersFromSource(value?: string | null) {
  const identifiers = new Set<string>();
  if (!value) return identifiers;

  SOURCE_IDENTIFIER_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(SOURCE_IDENTIFIER_PATTERN)) {
    const identifier = match[0]
      ?.normalize('NFKC')
      .replace(/\s+/gu, '')
      .toLocaleUpperCase('es-AR');
    if (identifier) {
      for (const variant of identifierVariants(identifier)) {
        identifiers.add(variant);
      }
    }
    const numericPart = match[0]?.match(/\d[\d.]*\/\d{2,4}/u)?.[0];
    if (numericPart) {
      for (const variant of identifierVariants(numericPart)) {
        identifiers.add(variant);
      }
    }
  }
  return identifiers;
}

function identifierVariants(value: string) {
  const canonical = canonicalizeIdentifier(value);
  const variants = new Set([canonical]);
  const withoutCaseCode = canonical.replace(/^[A-Z]{1,5}(?=\d)/u, '');
  if (withoutCaseCode !== canonical) variants.add(withoutCaseCode);
  return [...variants];
}

function canonicalizeIdentifier(value: string) {
  const compact = value
    .normalize('NFKC')
    .replace(/\s+/gu, '')
    .toLocaleUpperCase('es-AR');
  const match = compact.match(/^([A-Z]{1,5})?([\d.]+)\/(\d{2}|\d{4})$/u);
  if (!match) return compact;

  let year = match[3];
  if (year.length === 2) year = (Number(year) <= 30 ? '20' : '19') + year;
  return `${match[1] ?? ''}${match[2].replace(/\./gu, '')}/${year}`;
}

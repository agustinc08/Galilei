export type IdentifiedCitation = {
  rawCitation: string;
  identifier: string;
  normalizedIdentifier: string;
  identifierType: 'EXPEDIENTE' | 'NUMERO_SENTENCIA';
  extractionMethod: 'explicit-case-identifier-v1';
};

const PATTERNS: Array<{
  type: IdentifiedCitation['identifierType'];
  expression: RegExp;
}> = [
  {
    type: 'EXPEDIENTE',
    expression:
      /\bexp(?:ediente|te)?\.?\s*(?:n(?:ro|[º°.]?)\.?\s*)?((?:[A-Z]{1,5}[-\s]?)?\d[\d.]*\/\d{2,4})\b/giu,
  },
  {
    type: 'NUMERO_SENTENCIA',
    expression:
      /\b(?:sentencia|fallo)\s*(?:n(?:ro|[º°.]?)\.?\s*)?(\d{1,6}\/\d{2,4})\b/giu,
  },
];

/** Extract only explicit, year-qualified case identifiers; no fuzzy matching. */
export function extractIdentifiedCitations(text: string): IdentifiedCitation[] {
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

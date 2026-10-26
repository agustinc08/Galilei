export const ARGENTINE_CITATION_PARSER_V2 = 'argentine-citation-parser-v2';

export type CitationFamilyV2 =
  | 'EXPEDIENTE_IDENTIFIER'
  | 'CIVIL_EXPEDIENTE'
  | 'CNCIV_ROLLO'
  | 'CNCIV_SALA_DATE'
  | 'CSJN_FALLOS'
  | 'CSJN_CASE'
  | 'CSJN_DECISION_DATE'
  | 'OTHER_COURT'
  | 'STATUTE_REFERENCE';

export type CitationResolutionOutcome =
  | 'RESOLVED_UNIQUE'
  | 'AMBIGUOUS'
  | 'UNRESOLVED'
  | 'SELF_REFERENCE'
  | 'REJECTED_PATTERN';

export type CitationParsedFields = {
  court: string | null;
  chamber: string | null;
  expediente: string | null;
  decisionNumber: string | null;
  date: string | null;
  fallosVolume: number | null;
  fallosPage: number | null;
  statute: string | null;
};

export type CitationPageInput = {
  pageNumber: number;
  text: string;
  textKind?: string | null;
};

export type CitationCandidateV2 = {
  rawCitation: string;
  normalizedIdentifier: string | null;
  identifierType: 'EXPEDIENTE' | 'NUMERO_SENTENCIA' | null;
  family: CitationFamilyV2;
  parserVersion: typeof ARGENTINE_CITATION_PARSER_V2;
  sourcePage: number;
  sourceStartOffset: number;
  sourceEndOffset: number;
  sourceTextKind: string | null;
  sourceContext: string;
  parsedFields: CitationParsedFields;
  resolutionOutcome: CitationResolutionOutcome;
  resolutionReason: string;
};

export type CitationSourceIdentityV2 = {
  expediente?: string | null;
  numeroSentencia?: string | null;
};

export type CitationResolutionTarget = {
  id: number;
  expediente?: string | null;
  numeroSentencia?: string | null;
  sala?: string | null;
  fecha?: Date | string | null;
  publicado: boolean;
  activo: boolean;
};

export type CitationResolution = {
  outcome: CitationResolutionOutcome;
  targetSentenceId: number | null;
  candidateTargetIds: number[];
  reason: string;
};

const MAX_PAGE_TEXT_CHARS = 1_000_000;
const MAX_TOTAL_TEXT_CHARS = 3_000_000;
const MAX_SOURCE_PAGES = 10_000;
const MAX_PAGE_NUMBER = 100_000;
const CONTEXT_RADIUS = 240;
const CASE_FILE_PATTERN =
  /\b(?:exp(?:ediente|te)?\.?|causa)\s*(?:n(?:ro|[uú]m(?:ero)?|[º°.]?)\.?\s*)?((?:[A-Z]{1,8}\s*)?\d[\d.]{0,14}\s*\/\s*\d{2,4})\b/giu;
const CIV_ID_PATTERN = /\bCIV\s+(\d[\d.]{0,14}\s*\/\s*\d{2,4})\b/giu;
const FALLOS_PATTERN =
  /\bFallos["”']?\s*[:,]?\s*(\d{2,4})\s*:\s*(\d{1,5})\b/giu;
const CSJN_CASE_PATTERN =
  /\b(?:C\.?\s*S\.?\s*J\.?\s*N\.?|CSJ|CSJN)\s+(\d{1,6}\s*\/\s*\d{4}(?:\s*\(\d{1,3}-[A-Z]\)\s*\/\s*CS\d+|\s*\/\s*CS\d+(?:\/[A-Z]{1,3}\d*)?))\b/giu;
const CSJN_DECISION_DATE_PATTERN =
  /\b(?:C\.?\s*S\.?\s*J\.?\s*N\.?|CSJ|CSJN)\s*,?\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{4})\b/giu;
const CNCIV_SALA_DATE_PATTERN =
  /\bCNCiv\.?\s*,?\s*(?:esta\s+)?Sala\s*["“']?([A-M])["”']?\s*,?\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b/giu;
const CNCIV_ROLLO_PATTERN =
  /\bR\.?\s*(\d{1,3}(?:\.\d{3}){0,2}|\d{4,9})\s+(?:del|de\s+fecha)\s+(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b/giu;
const OTHER_COURT_PATTERN =
  /\b(CSJN|C\.?\s*S\.?\s*J\.?\s*N\.?|SCBA|CNCiv\.?\s+en\s+pleno|CNCom\.?|CNAT\.?|CNCAF\.?)\b/giu;
const STATUTE_PATTERN =
  /\b(?:art(?:[ií]culo)?s?\.?\s*\d{1,4}(?:\s*(?:bis|ter|qu[aá]ter))?(?:\s*(?:,|y|e)\s*\d{1,4}(?:\s*(?:bis|ter|qu[aá]ter))?)*(?:\s+(?:de\s+)?(?:la\s+)?(?:ley|c[oó]d(?:igo)?|decreto)\s*(?:n(?:ro|[º°.]?)\s*)?\d{1,6}(?:\.\d{3})?|\s+(?:del?|de\s+la)\s+(?:CPCCN?|CPCCyT|CCyC|CCCN|C[oó]digo\s+Civil(?:\s+y\s+Comercial)?))?|(?:ley|c[oó]d(?:igo)?|decreto)\s*(?:n(?:ro|[º°.]?)\s*)?\d{1,6}(?:\.\d{3})?\s*,?\s*art(?:[ií]culo)?s?\.?\s*\d{1,4}|(?:ley|c[oó]d(?:igo)?|decreto)\s*(?:n(?:ro|[º°.]?)\s*)?\d{1,6}(?:\.\d{3})?)\b/giu;

type RawDetection = {
  start: number;
  end: number;
  raw: string;
  family: CitationFamilyV2;
  identifierType: CitationCandidateV2['identifierType'];
  normalizedIdentifier: string | null;
  parsedFields: CitationParsedFields;
  resolutionReason: string;
};

const EMPTY_FIELDS: CitationParsedFields = {
  court: null,
  chamber: null,
  expediente: null,
  decisionNumber: null,
  date: null,
  fallosVolume: null,
  fallosPage: null,
  statute: null,
};

/** Parses only bounded, explicit citation forms found in the sampled Civil corpus. */
export function parseArgentineCitationsV2(
  pages: readonly CitationPageInput[],
  source: CitationSourceIdentityV2 = {},
): CitationCandidateV2[] {
  if (pages.length > MAX_SOURCE_PAGES) return [];
  const sorted = [...pages]
    .filter(
      (page) =>
        Number.isInteger(page.pageNumber) &&
        page.pageNumber > 0 &&
        page.pageNumber <= MAX_PAGE_NUMBER &&
        typeof page.text === 'string' &&
        page.text.length <= MAX_PAGE_TEXT_CHARS,
    )
    .sort((left, right) => left.pageNumber - right.pageNumber);
  if (
    sorted.reduce((total, page) => total + page.text.length, 0) >
    MAX_TOTAL_TEXT_CHARS
  ) {
    return [];
  }

  const results: CitationCandidateV2[] = [];
  for (const page of sorted) {
    const detections = detectOnPage(page.text);
    for (const item of detections) {
      const self = isSourceIdentity(item, source);
      results.push({
        rawCitation: item.raw,
        normalizedIdentifier: item.normalizedIdentifier,
        identifierType: item.identifierType,
        family: item.family,
        parserVersion: ARGENTINE_CITATION_PARSER_V2,
        sourcePage: page.pageNumber,
        sourceStartOffset: item.start,
        sourceEndOffset: item.end,
        sourceTextKind: page.textKind ?? null,
        sourceContext: buildSourceContext(page.text, item.start, item.end),
        parsedFields: item.parsedFields,
        resolutionOutcome: self ? 'SELF_REFERENCE' : 'UNRESOLVED',
        resolutionReason: self
          ? 'La identificación coincide exactamente con el fallo de origen.'
          : item.resolutionReason,
      });
    }
  }
  return results;
}

/** Exact identifier resolution only; published/active filtering happens here. */
export function resolveCitationV2(
  citation: CitationCandidateV2,
  sourceId: number,
  targets: readonly CitationResolutionTarget[],
): CitationResolution {
  if (citation.resolutionOutcome === 'SELF_REFERENCE') {
    return {
      outcome: 'SELF_REFERENCE',
      targetSentenceId: null,
      candidateTargetIds: [],
      reason: citation.resolutionReason,
    };
  }
  if (!citation.identifierType || !citation.normalizedIdentifier) {
    return {
      outcome: 'UNRESOLVED',
      targetSentenceId: null,
      candidateTargetIds: [],
      reason: citation.resolutionReason,
    };
  }

  const candidates = targets.filter((target) => {
    if (!target.publicado || !target.activo || target.id === sourceId)
      return false;
    const field =
      citation.identifierType === 'EXPEDIENTE'
        ? target.expediente
        : target.numeroSentencia;
    if (normalizeLegalIdentifier(field) !== citation.normalizedIdentifier)
      return false;
    if (
      citation.parsedFields.chamber &&
      normalizeChamber(target.sala) !==
        normalizeChamber(citation.parsedFields.chamber)
    ) {
      return false;
    }
    if (
      citation.parsedFields.date &&
      dateOnly(target.fecha) !== citation.parsedFields.date
    ) {
      return false;
    }
    return true;
  });

  const candidateTargetIds = candidates
    .map((item) => item.id)
    .sort((a, b) => a - b);
  if (candidateTargetIds.length === 1) {
    return {
      outcome: 'RESOLVED_UNIQUE',
      targetSentenceId: candidateTargetIds[0],
      candidateTargetIds,
      reason:
        'Un identificador exacto y único coincide con un fallo publicado y activo.',
    };
  }
  if (candidateTargetIds.length > 1) {
    return {
      outcome: 'AMBIGUOUS',
      targetSentenceId: null,
      candidateTargetIds,
      reason: `El identificador exacto coincide con ${candidateTargetIds.length} fallos publicados y activos.`,
    };
  }
  return {
    outcome: 'UNRESOLVED',
    targetSentenceId: null,
    candidateTargetIds: [],
    reason: 'No hay un fallo publicado y activo con identificador exacto.',
  };
}

export function normalizeLegalIdentifier(value?: string | null) {
  if (!value) return null;
  const normalized = value
    .normalize('NFKC')
    .toLocaleUpperCase('es-AR')
    .replace(/\b(?:EXPTE|EXPEDIENTE|CAUSA|SENTENCIA|FALLO|CIV)\b/gu, ' ')
    .replace(/\bN(?:RO|[ÚU]M(?:ERO)?|[º°.]?)\b/gu, ' ')
    .replace(/\s+/gu, '')
    .replace(/\.(?=\d{3}(?:\/|\d))/gu, '')
    .replace(/^[^\p{L}\p{N}]+/u, '');
  const match = normalized.match(/^([A-Z]{1,8})?(\d{1,15})\/(\d{4}|\d{2})$/u);
  return match ? `${match[1] ?? ''}${match[2]}/${match[3]}` : null;
}

function detectOnPage(text: string): RawDetection[] {
  const output: RawDetection[] = [];
  const add = (
    regex: RegExp,
    create: (
      match: RegExpExecArray,
    ) => Omit<RawDetection, 'start' | 'end' | 'raw'>,
  ) => {
    regex.lastIndex = 0;
    for (const match of text.matchAll(regex)) {
      const start = match.index ?? -1;
      if (start < 0 || !match[0]) continue;
      output.push({
        ...create(match),
        start,
        end: start + match[0].length,
        raw: match[0].trim(),
      });
    }
  };

  add(CASE_FILE_PATTERN, (match) => {
    const identifier = normalizeLegalIdentifier(match[1]);
    return {
      family: /^CIV\s+/iu.test(match[1])
        ? 'CIVIL_EXPEDIENTE'
        : 'EXPEDIENTE_IDENTIFIER',
      identifierType: 'EXPEDIENTE',
      normalizedIdentifier: identifier,
      parsedFields: { ...EMPTY_FIELDS, expediente: match[1].trim() },
      resolutionReason: identifier
        ? 'Expediente explícito; resolución exacta pendiente.'
        : 'El formato del expediente no permite normalización segura.',
    };
  });
  add(CIV_ID_PATTERN, (match) => {
    const identifier = normalizeLegalIdentifier(match[1]);
    return {
      family: 'CIVIL_EXPEDIENTE',
      identifierType: 'EXPEDIENTE',
      normalizedIdentifier: identifier,
      parsedFields: { ...EMPTY_FIELDS, expediente: match[1].trim() },
      resolutionReason: identifier
        ? 'Identificador CIV explícito; resolución exacta pendiente.'
        : 'El formato CIV no permite normalización segura.',
    };
  });
  add(FALLOS_PATTERN, (match) => ({
    family: 'CSJN_FALLOS',
    identifierType: null,
    normalizedIdentifier: null,
    parsedFields: {
      ...EMPTY_FIELDS,
      court: 'CSJN',
      fallosVolume: Number(match[1]),
      fallosPage: Number(match[2]),
    },
    resolutionReason:
      'Referencia Fallos parseada; no hay destino resoluble en la colección civil local.',
  }));
  add(CSJN_CASE_PATTERN, (match) => {
    const identifier = normalizeLegalIdentifier(match[1]);
    return {
      family: 'CSJN_CASE',
      identifierType: null,
      normalizedIdentifier: identifier,
      parsedFields: {
        ...EMPTY_FIELDS,
        court: 'CSJN',
        decisionNumber: match[1].trim(),
      },
      resolutionReason:
        'Identificador CSJN parseado; no hay destino resoluble en la colección civil local.',
    };
  });
  add(CSJN_DECISION_DATE_PATTERN, (match) => ({
    family: 'CSJN_DECISION_DATE',
    identifierType: null,
    normalizedIdentifier: null,
    parsedFields: {
      ...EMPTY_FIELDS,
      court: 'CSJN',
      date: normalizeDate(match[1]) ?? match[1],
    },
    resolutionReason:
      'Fecha de una decisión de la CSJN; la fecha sola no identifica inequívocamente un fallo.',
  }));
  add(CNCIV_SALA_DATE_PATTERN, (match) => ({
    family: 'CNCIV_SALA_DATE',
    identifierType: null,
    normalizedIdentifier: null,
    parsedFields: {
      ...EMPTY_FIELDS,
      court: 'CNCiv',
      chamber: normalizeChamber(match[1]),
      date: normalizeDate(match[2]) ?? match[2],
    },
    resolutionReason:
      'Sala y fecha por sí solas no identifican inequívocamente un fallo.',
  }));
  add(CNCIV_ROLLO_PATTERN, (match) => ({
    family: 'CNCIV_ROLLO',
    identifierType: null,
    normalizedIdentifier: null,
    parsedFields: {
      ...EMPTY_FIELDS,
      court: 'CNCiv',
      decisionNumber: match[1].replace(/\./gu, ''),
      date: normalizeDate(match[2]) ?? match[2],
    },
    resolutionReason:
      'Número de registro y fecha; no coincide con un identificador canónico de fallo.',
  }));
  add(STATUTE_PATTERN, (match) => ({
    family: 'STATUTE_REFERENCE',
    identifierType: null,
    normalizedIdentifier: null,
    parsedFields: {
      ...EMPTY_FIELDS,
      statute: match[0].replace(/\s+/gu, ' ').trim(),
    },
    resolutionReason:
      'Referencia normativa detectada; no se crea una relación entre fallos.',
  }));
  add(OTHER_COURT_PATTERN, (match) => ({
    family: 'OTHER_COURT',
    identifierType: null,
    normalizedIdentifier: null,
    parsedFields: {
      ...EMPTY_FIELDS,
      court: match[1].replace(/\s+/gu, ' ').trim(),
    },
    resolutionReason:
      'Tribunal mencionado sin identificador suficiente para resolver un fallo.',
  }));

  const courtReferences = output.filter((item) => {
    if (item.family !== 'OTHER_COURT') return true;
    const court = item.parsedFields.court
      ?.replace(/[.\s]/gu, '')
      .toLocaleUpperCase('es-AR');
    const context = text.slice(
      Math.max(0, item.start - 100),
      Math.min(text.length, item.end + 100),
    );
    const nearbySpecificCitation = output.some(
      (candidate) =>
        (candidate.family === 'CSJN_FALLOS' ||
          candidate.family === 'CSJN_CASE' ||
          candidate.family === 'CSJN_DECISION_DATE') &&
        Math.abs(candidate.start - item.start) <= 80,
    );
    if (court === 'CSJN' && nearbySpecificCitation) return false;
    if (court === 'CSJN' && /\bacordad(?:a|as)\b/iu.test(context)) return false;
    return /(?:\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\b(?:expte|expediente|fallos|l\.?\s*l\.?|ed\.?|djba|plenario|ac\.)\b)/iu.test(
      context,
    );
  });

  const byOccurrence = new Map<string, RawDetection>();
  for (const item of courtReferences.sort(
    (left, right) => left.start - right.start || right.end - left.end,
  )) {
    const key = `${item.start}:${item.end}:${item.family}`;
    if (!byOccurrence.has(key)) byOccurrence.set(key, item);
  }
  const retained: RawDetection[] = [];
  const lastEndByIdentifier = new Map<string, number>();
  for (const item of byOccurrence.values()) {
    const key =
      item.identifierType && item.normalizedIdentifier
        ? `${item.identifierType}:${item.normalizedIdentifier}`
        : null;
    const previousEnd = key ? lastEndByIdentifier.get(key) : undefined;
    if (previousEnd !== undefined && item.start < previousEnd) continue;
    retained.push(item);
    if (key) lastEndByIdentifier.set(key, item.end);
  }
  return retained;
}

function isSourceIdentity(
  item: RawDetection,
  source: CitationSourceIdentityV2,
) {
  if (!item.normalizedIdentifier || !item.identifierType) return false;
  const sourceValue =
    item.identifierType === 'EXPEDIENTE'
      ? source.expediente
      : source.numeroSentencia;
  return normalizeLegalIdentifier(sourceValue) === item.normalizedIdentifier;
}

function normalizeChamber(value?: string | null) {
  return (
    value
      ?.normalize('NFKC')
      .toLocaleUpperCase('es-AR')
      .replace(/^SALA\s*/u, '')
      .trim() || null
  );
}

function normalizeDate(value: string) {
  const match = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/u);
  if (!match) return null;
  const year = match[3];
  // Two-digit years remain unresolved rather than assigning a century.
  if (year.length !== 4) return null;
  const day = match[1].padStart(2, '0');
  const month = match[2].padStart(2, '0');
  const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== `${year}-${month}-${day}`
  ) {
    return null;
  }
  return `${year}-${month}-${day}`;
}

function dateOnly(value?: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function buildSourceContext(text: string, start: number, end: number) {
  const from = Math.max(0, start - CONTEXT_RADIUS);
  const to = Math.min(text.length, end + CONTEXT_RADIUS);
  return text.slice(from, to).replace(/\s+/gu, ' ').trim().slice(0, 800);
}

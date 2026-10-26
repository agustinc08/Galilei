export const STRUCTURED_JUDGMENT_PARSER_VERSION =
  'argentine-civil-structure-v1';

export type JudgmentPageText = {
  pageNumber: number;
  text: string;
};

export type JudgmentSectionType =
  | 'VISTOS'
  | 'RESULTA'
  | 'CONSIDERANDO'
  | 'NUMBERED_SECTION'
  | 'RESUELVE'
  | 'OTHER_HEADING';

export type StructuredJudgmentSection = {
  type: JudgmentSectionType;
  label: string;
  ordinal: string | null;
  pageStart: number;
  pageEnd: number | null;
  startOffset: number;
  endOffset: number;
  rawHeading: string;
  status: 'DETECTED';
  confidence: 'HIGH';
  parserVersion: typeof STRUCTURED_JUDGMENT_PARSER_VERSION;
};

type Heading = Omit<StructuredJudgmentSection, 'pageEnd'> & {
  lineIndex: number;
};

const MAX_PAGE_TEXT_LENGTH = 1_000_000;
const MAX_TOTAL_SOURCE_TEXT_LENGTH = 10_000_000;
const MAX_SOURCE_PAGES = 10_000;
const MAX_PAGE_NUMBER = 100_000;
const MAJOR_HEADING_PATTERNS: Array<{
  expression: RegExp;
  type: JudgmentSectionType;
  label: string;
}> = [
  {
    expression: /^(?:AUTOS\s+Y\s+)?VISTOS(?:\s+Y\s+CONSIDERANDO)?\s*[:.]?$/u,
    type: 'VISTOS',
    label: 'Vistos',
  },
  {
    expression: /^RESULTA(?:NDO)?\s*[:.]?$/u,
    type: 'RESULTA',
    label: 'Resulta',
  },
  {
    expression: /^(?:Y\s+)?CONSIDERANDO\s*[:.]?$/u,
    type: 'CONSIDERANDO',
    label: 'Considerando',
  },
  {
    expression: /^(?:SE\s+)?RESUELVE\s*[:.]?$/u,
    type: 'RESUELVE',
    label: 'Resolución',
  },
  {
    expression: /^(?:FALLA|FALLO)\s*[:.]?$/u,
    type: 'RESUELVE',
    label: 'Fallo',
  },
  {
    expression: /^PARTE\s+DISPOSITIVA\s*[:.]?$/u,
    type: 'RESUELVE',
    label: 'Parte dispositiva',
  },
  {
    expression: /^FUNDAMENTOS(?:\s+DE\s+LA\s+DECISI[ÓO]N)?\s*[:.]?$/u,
    type: 'OTHER_HEADING',
    label: 'Fundamentos',
  },
];

const NUMBERED_HEADING =
  /^(?<ordinal>VIII|VII|VI|IV|V|III|II|I|\d{1,3}|PRIMERO|SEGUNDO|TERCERO|CUARTO|QUINTO|SEXTO|S[EÉ]PTIMO|OCTAVO|NOVENO|D[EÉ]CIMO)(?:\s*(?:\.|\)|-|–|—)+\s*)(?<title>[\p{L}\p{N}][\p{L}\p{N}\s.,:;()/'"“”–—-]{1,110})$/u;

/**
 * Detects only heading forms observed in published Civil PDF text. Offsets are
 * UTF-16 offsets within the extracted source page; page numbers are 1-based PDF
 * page indexes. The function never synthesizes printed-page numbers.
 */
export function parseStructuredJudgment(
  inputPages: readonly JudgmentPageText[],
  options: { completeSource?: boolean } = {},
): StructuredJudgmentSection[] {
  if (inputPages.length > MAX_SOURCE_PAGES) return [];
  const pages = [...inputPages]
    .filter(
      (page) =>
        Number.isInteger(page.pageNumber) &&
        page.pageNumber > 0 &&
        page.pageNumber <= MAX_PAGE_NUMBER &&
        typeof page.text === 'string' &&
        page.text.length <= MAX_PAGE_TEXT_LENGTH,
    )
    .sort((left, right) => left.pageNumber - right.pageNumber);
  if (
    pages.reduce((total, page) => total + page.text.length, 0) >
    MAX_TOTAL_SOURCE_TEXT_LENGTH
  ) {
    return [];
  }

  const headings: Heading[] = [];
  for (const page of pages) {
    let lineIndex = 0;
    for (const match of page.text.matchAll(/[^\r\n]+/gu)) {
      const rawLine = match[0];
      const line = rawLine.replace(/^\uFEFF/u, '').trim();
      const startOffset = (match.index ?? 0) + rawLine.indexOf(line);
      const endOffset = startOffset + line.length;
      lineIndex += 1;
      if (!line || line.length > 120 || !isUppercaseHeading(line)) continue;

      const major = MAJOR_HEADING_PATTERNS.find((item) =>
        item.expression.test(line),
      );
      if (major) {
        headings.push({
          type: major.type,
          label:
            major.type === 'VISTOS' && /CONSIDERANDO/iu.test(line)
              ? 'Vistos y Considerando'
              : major.label,
          ordinal: null,
          pageStart: page.pageNumber,
          startOffset,
          endOffset,
          rawHeading: line,
          status: 'DETECTED',
          confidence: 'HIGH',
          parserVersion: STRUCTURED_JUDGMENT_PARSER_VERSION,
          lineIndex,
        });
        continue;
      }

      const numbered = NUMBERED_HEADING.exec(line);
      const ordinal = numbered?.groups?.ordinal;
      const title = numbered?.groups?.title
        ?.trim()
        .replace(/[.:;]+$/u, '')
        .trim();
      if (!ordinal || !title || title.length < 3 || !isUppercaseHeading(title))
        continue;

      headings.push({
        type: 'NUMBERED_SECTION',
        label: `${ordinal} · ${title}`,
        ordinal,
        pageStart: page.pageNumber,
        startOffset,
        endOffset,
        rawHeading: line,
        status: 'DETECTED',
        confidence: 'HIGH',
        parserVersion: STRUCTURED_JUDGMENT_PARSER_VERSION,
        lineIndex,
      });
    }
  }

  const hasNumberedContext =
    headings.some(
      (heading) =>
        heading.type === 'CONSIDERANDO' ||
        (heading.type === 'VISTOS' &&
          /CONSIDERANDO/iu.test(heading.rawHeading)),
    ) ||
    headings.filter((heading) => heading.type === 'NUMBERED_SECTION').length >=
      2;

  const filtered = headings.filter(
    (heading) => heading.type !== 'NUMBERED_SECTION' || hasNumberedContext,
  );
  const deduplicated = suppressRepeatedRunningHeadings(filtered);
  deduplicated.sort(
    (left, right) =>
      left.pageStart - right.pageStart || left.startOffset - right.startOffset,
  );

  const availablePages = new Set(pages.map((page) => page.pageNumber));
  const lastPage = pages.at(-1)?.pageNumber ?? null;
  return deduplicated.map((heading, index) => {
    const next = deduplicated[index + 1];
    const endPage = next
      ? next.pageStart > heading.pageStart
        ? next.pageStart - 1
        : heading.pageStart
      : options.completeSource === false
        ? null
        : lastPage;
    const pageEnd =
      endPage !== null &&
      isContiguousPageRange(availablePages, heading.pageStart, endPage)
        ? endPage
        : null;
    const { lineIndex, ...section } = heading;
    void lineIndex;
    return { ...section, pageEnd };
  });
}

function isUppercaseHeading(value: string) {
  const letters = value.match(/[\p{L}]/gu) ?? [];
  if (letters.length < 3) return false;
  const uppercase = value.toLocaleUpperCase('es-AR');
  const lowercase = value.toLocaleLowerCase('es-AR');
  return value === uppercase && uppercase !== lowercase;
}

function suppressRepeatedRunningHeadings(headings: Heading[]) {
  const output: Heading[] = [];
  const lastByHeading = new Map<string, Heading>();
  for (const heading of headings) {
    const key = `${heading.type}:${heading.rawHeading
      .normalize('NFKC')
      .replace(/\s+/gu, ' ')
      .trim()}`;
    const previous = lastByHeading.get(key);
    const repeatedAtPageTop = Boolean(
      previous &&
      heading.pageStart === previous.pageStart + 1 &&
      heading.lineIndex <= 3 &&
      previous.lineIndex <= 3,
    );
    if (repeatedAtPageTop) continue;
    output.push(heading);
    lastByHeading.set(key, heading);
  }
  return output;
}

function isContiguousPageRange(
  available: Set<number>,
  start: number,
  end: number,
) {
  if (end < start) return false;
  const requiredCount = end - start + 1;
  if (requiredCount > available.size) return false;
  let availableInRange = 0;
  for (const page of available) {
    if (page >= start && page <= end) availableInRange += 1;
  }
  return availableInRange === requiredCount;
}

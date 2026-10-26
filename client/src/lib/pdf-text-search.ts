export type PdfTextFragment = {
  str: string;
  transform?: readonly number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
};

export type PdfTextMatch = {
  page: number;
  offset: number;
  sourceStart: number;
  sourceEnd: number;
  passage: string;
};

/**
 * Joins PDF.js text runs into readable page text. PDF.js often splits words
 * into separate items, so geometry is used to avoid adding spaces inside a
 * word while retaining spaces between words and lines.
 */
export function joinPdfTextItems(items: readonly PdfTextFragment[]): string {
  let text = '';
  let previous: PdfTextFragment | undefined;

  for (const item of items) {
    if (!item.str) continue;

    if (previous) {
      const previousY = previous.transform?.[5];
      const currentY = item.transform?.[5];
      const previousX = previous.transform?.[4];
      const currentX = item.transform?.[4];
      const height = Math.max(1, Math.abs(previous.height ?? item.height ?? 10));
      const changedLine =
        previous.hasEOL === true ||
        (Number.isFinite(previousY) &&
          Number.isFinite(currentY) &&
          Math.abs((currentY as number) - (previousY as number)) > height * 0.45);

      if (changedLine) {
        const previousText = previous.str;
        const nextText = item.str;
        const isWrappedWord = /[a-záéíóúü]-(?:\s*)$/iu.test(previousText) &&
          /^[a-záéíóúü]/iu.test(nextText);
        if (isWrappedWord && text.endsWith('-')) {
          text = text.slice(0, -1);
        } else if (!/\s$/u.test(text) && !/^\s/u.test(nextText)) {
          text += ' ';
        }
      } else if (
        Number.isFinite(previousX) &&
        Number.isFinite(currentX) &&
        Number.isFinite(previous.width) &&
        /[\p{L}\p{N}]$/u.test(text) &&
        /^[\p{L}\p{N}]/u.test(item.str)
      ) {
        const gap = (currentX as number) - (previousX as number) - (previous.width as number);
        if (gap > Math.max(1, height * 0.12)) text += ' ';
      }
    }

    text += item.str;
    previous = item;
  }

  return text;
}

/** Fold accents while keeping ñ distinct from n, as Galilei's Search contract requires. */
export function normalizePdfSearchText(value: string): string {
  const protectedEnye = value.replace(/[ñÑ]/gu, '\uE000');
  return protectedEnye
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/\uE000/gu, 'ñ')
    .toLocaleLowerCase('es-AR')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function findPdfTextMatches(
  pages: readonly string[],
  query: string,
): PdfTextMatch[] {
  const normalizedQuery = normalizePdfSearchText(query);
  if (!normalizedQuery) return [];

  const matches: PdfTextMatch[] = [];
  pages.forEach((pageText, pageIndex) => {
    const mapped = normalizePdfSearchTextWithSourceOffsets(pageText);
    const normalizedPage = mapped.text;
    let offset = 0;
    while (offset <= normalizedPage.length - normalizedQuery.length) {
      const foundAt = normalizedPage.indexOf(normalizedQuery, offset);
      if (foundAt < 0) break;
      const sourceStart = mapped.ranges[foundAt]?.start;
      const sourceEnd = mapped.ranges[foundAt + normalizedQuery.length - 1]?.end;
      if (sourceStart !== undefined && sourceEnd !== undefined) {
        matches.push({
          page: pageIndex + 1,
          offset: foundAt,
          sourceStart,
          sourceEnd,
          passage: pageText.slice(sourceStart, sourceEnd),
        });
      }
      offset = foundAt + Math.max(1, normalizedQuery.length);
    }
  });
  return matches;
}

function normalizePdfSearchTextWithSourceOffsets(value: string) {
  let text = '';
  const ranges: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < value.length;) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) break;
    const sourceChar = String.fromCodePoint(codePoint);
    const sourceEnd = index + sourceChar.length;
    const folded = /[ñÑ]/u.test(sourceChar)
      ? sourceChar.toLocaleLowerCase('es-AR')
      : sourceChar
          .normalize('NFKD')
          .replace(/\p{M}/gu, '')
          .toLocaleLowerCase('es-AR');
    if (!folded) {
      const last = ranges.at(-1);
      if (last) last.end = sourceEnd;
      index = sourceEnd;
      continue;
    }
    for (const normalizedChar of folded) {
      if (/\s/u.test(normalizedChar)) {
        if (!text || text.endsWith(' ')) {
          if (text.endsWith(' ')) ranges[ranges.length - 1].end = sourceEnd;
          index = sourceEnd;
          continue;
        }
        text += ' ';
        ranges.push({ start: index, end: sourceEnd });
        continue;
      }
      for (let unit = 0; unit < normalizedChar.length; unit += 1) {
        text += normalizedChar[unit];
        ranges.push({ start: index, end: sourceEnd });
      }
    }
    index = sourceEnd;
  }
  if (text.endsWith(' ')) {
    text = text.slice(0, -1);
    ranges.pop();
  }
  return { text, ranges };
}

export async function getPdfPageCount(
  blob: Blob,
  signal: AbortSignal,
): Promise<number> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();
  const bytes = await blob.arrayBuffer();
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const abortLoading = () => void loadingTask.destroy();
  signal.addEventListener('abort', abortLoading, { once: true });
  try {
    const document = await loadingTask.promise;
    return document.numPages;
  } finally {
    signal.removeEventListener('abort', abortLoading);
    await loadingTask.destroy().catch(() => undefined);
  }
}

/** Extracts page text locally in the browser; no PDF bytes or query leave the device. */
export async function extractPdfTextPages(
  blob: Blob,
  signal: AbortSignal,
  onProgress?: (page: number, pageCount: number) => void,
): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();

  const bytes = await blob.arrayBuffer();
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const abortLoading = () => void loadingTask.destroy();
  signal.addEventListener('abort', abortLoading, { once: true });

  try {
    const document = await loadingTask.promise;
    const pageTexts: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const fragments = content.items.flatMap((item) =>
        'str' in item ? [{
          str: item.str,
          transform: item.transform,
          width: item.width,
          height: item.height,
          hasEOL: item.hasEOL,
        }] : [],
      );
      pageTexts.push(joinPdfTextItems(fragments));
      onProgress?.(pageNumber, document.numPages);
    }
    return pageTexts;
  } finally {
    signal.removeEventListener('abort', abortLoading);
    await loadingTask.destroy().catch(() => undefined);
  }
}

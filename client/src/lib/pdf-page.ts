/** Parse a URL page parameter without passing malformed values to a PDF viewer. */
export function parsePdfPageParam(value: string | null | undefined): number {
  if (value === null || value === undefined || !/^\d+$/u.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

/** Return a positive integer page, clamped once the PDF page count is known. */
export function clampPdfPage(page: number, pageCount: number): number {
  const safePage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  return Number.isSafeInteger(pageCount) && pageCount > 0
    ? Math.min(safePage, pageCount)
    : safePage;
}

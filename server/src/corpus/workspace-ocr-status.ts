export type WorkspaceOcrState =
  | 'NOT_REQUIRED'
  | 'NEEDS_OCR'
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'ERROR';

const NON_RETRYABLE_ERRORS = new Set([
  'FILE_INVALID',
  'OCR_DISABLED',
  'OCR_LANGUAGE_UNAVAILABLE',
  'OCR_LOW_QUALITY',
  'OCR_PAGE_LIMIT',
  'OCR_PROCESSOR_CHANGED',
  'SOURCE_REPLACED',
]);
const MIN_WORKSPACE_SEARCH_TEXT_LENGTH = 8;

export function isRetryableWorkspaceOcrError(
  errorCode: string | null | undefined,
) {
  return Boolean(errorCode && !NON_RETRYABLE_ERRORS.has(errorCode));
}

export function canStartWorkspaceOcr(input: {
  state: WorkspaceOcrState;
  role: string;
  canRetry: boolean;
}) {
  if (input.role !== 'ADMIN' && input.role !== 'EDITOR') return false;
  return (
    input.state === 'NEEDS_OCR' || (input.state === 'ERROR' && input.canRetry)
  );
}

export function workspaceOcrState(input: {
  documentStatus: string;
  extractionStatus?: string | null;
  jobStatus?: string | null;
  requiresOcr?: boolean;
}): WorkspaceOcrState {
  if (input.jobStatus === 'PENDING') return 'PENDING';
  if (input.jobStatus === 'RUNNING') return 'PROCESSING';
  if (
    input.jobStatus === 'COMPLETE' ||
    input.extractionStatus === 'OCR_COMPLETE'
  )
    return 'COMPLETED';
  if (input.jobStatus === 'FAILED' || input.documentStatus === 'OCR_FAILED')
    return 'ERROR';
  if (input.jobStatus === 'CANCELLED') return 'NEEDS_OCR';
  if (input.requiresOcr !== undefined)
    return input.requiresOcr ? 'NEEDS_OCR' : 'NOT_REQUIRED';
  if (input.documentStatus === 'OCR_PROCESSING') return 'PROCESSING';
  if (input.documentStatus === 'OCR_REQUIRED') return 'NEEDS_OCR';
  return 'NOT_REQUIRED';
}

export function needsWorkspaceOcrPage(page: {
  text: string;
  textKind?: string | null;
  processingStatus?: string | null;
}) {
  const usableLength = page.text.replace(/\s+/gu, '').trim().length;
  if (
    page.textKind === 'NATIVE' &&
    usableLength >= MIN_WORKSPACE_SEARCH_TEXT_LENGTH
  )
    return false;
  if (
    (page.textKind === 'OCR' &&
      (page.processingStatus === 'OCR_HUMAN_APPROVED' ||
        page.processingStatus === 'OCR_COMPLETE') &&
      usableLength > 0) ||
    page.processingStatus === 'OCR_HUMAN_APPROVED'
  )
    return false;
  return (
    page.processingStatus === 'OCR_REQUIRED' ||
    usableLength < MIN_WORKSPACE_SEARCH_TEXT_LENGTH
  );
}

export function hasUsableWorkspaceNativeText(page: {
  text: string;
  textKind?: string | null;
  processingStatus?: string | null;
}) {
  if (page.textKind !== 'NATIVE') return false;
  return (
    page.text.replace(/\s+/gu, '').trim().length >=
    MIN_WORKSPACE_SEARCH_TEXT_LENGTH
  );
}

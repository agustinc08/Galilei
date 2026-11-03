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

export function isRetryableWorkspaceOcrError(
  errorCode: string | null | undefined,
) {
  return Boolean(errorCode && !NON_RETRYABLE_ERRORS.has(errorCode));
}

export function workspaceOcrState(input: {
  documentStatus: string;
  extractionStatus?: string | null;
  jobStatus?: string | null;
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
  if (input.documentStatus === 'OCR_PROCESSING') return 'PROCESSING';
  if (input.documentStatus === 'OCR_REQUIRED') return 'NEEDS_OCR';
  return 'NOT_REQUIRED';
}

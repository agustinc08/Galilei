import {
  canStartWorkspaceOcr,
  isRetryableWorkspaceOcrError,
  workspaceOcrState,
} from './workspace-ocr-status';

describe('Workspace OCR status', () => {
  it.each([
    ['OCR_REQUIRED', null, null, 'NEEDS_OCR'],
    ['OCR_PROCESSING', null, 'PENDING', 'PENDING'],
    ['OCR_PROCESSING', null, 'RUNNING', 'PROCESSING'],
    ['INDEXED', 'OCR_COMPLETE', 'COMPLETE', 'COMPLETED'],
    ['OCR_FAILED', 'TEXT_EXTRACTED', 'FAILED', 'ERROR'],
    ['INDEXED', 'TEXT_EXTRACTED', null, 'NOT_REQUIRED'],
  ] as const)(
    'maps document, extraction, and job states to %s/%s/%s => %s',
    (documentStatus, extractionStatus, jobStatus, expected) => {
      expect(
        workspaceOcrState({ documentStatus, extractionStatus, jobStatus }),
      ).toBe(expected);
    },
  );

  it('allows retry only for errors that may recover without replacing the source PDF', () => {
    expect(isRetryableWorkspaceOcrError('OCR_TIMEOUT')).toBe(true);
    expect(isRetryableWorkspaceOcrError('OCR_RENDER_FAILED')).toBe(true);
    expect(isRetryableWorkspaceOcrError('FILE_INVALID')).toBe(false);
    expect(isRetryableWorkspaceOcrError('OCR_LOW_QUALITY')).toBe(false);
    expect(isRetryableWorkspaceOcrError(null)).toBe(false);
  });

  it.each([
    ['EDITOR', 'NEEDS_OCR', false, true],
    ['ADMIN', 'NEEDS_OCR', false, true],
    ['VIEWER', 'NEEDS_OCR', false, false],
    ['EDITOR', 'ERROR', true, true],
    ['VIEWER', 'ERROR', true, false],
    ['EDITOR', 'ERROR', false, false],
    ['EDITOR', 'COMPLETED', false, false],
    ['ADMIN', 'NOT_REQUIRED', false, false],
  ] as const)(
    'allows %s to start state %s (retry=%s): %s',
    (role, state, canRetry, expected) => {
      expect(canStartWorkspaceOcr({ role, state, canRetry })).toBe(expected);
    },
  );
});

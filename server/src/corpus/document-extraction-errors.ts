export class DocumentExtractionError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'DocumentExtractionError';
  }
}

export class InvalidPdfError extends DocumentExtractionError {
  constructor(message = 'Invalid PDF document.') {
    super(message, 'INVALID_PDF');
    this.name = 'InvalidPdfError';
  }
}

export class UnsupportedDocumentError extends DocumentExtractionError {
  constructor(
    code = 'UNSUPPORTED_FORMAT',
    message = 'Document format is not supported.',
  ) {
    super(message, code);
    this.name = 'UnsupportedDocumentError';
  }
}

export class EncryptedDocumentError extends DocumentExtractionError {
  constructor() {
    super(
      'Password-protected Office documents are not supported.',
      'ENCRYPTED_UNSUPPORTED',
    );
    this.name = 'EncryptedDocumentError';
  }
}

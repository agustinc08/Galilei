import path from 'node:path';
import type { DocumentFormat } from './document-format-detector';

const ALLOWED_FOLDER_UPLOADS: Record<
  string,
  { format: DocumentFormat; mimeTypes: ReadonlySet<string> }
> = {
  '.pdf': { format: 'PDF', mimeTypes: new Set(['application/pdf']) },
  '.doc': { format: 'DOC', mimeTypes: new Set(['application/msword']) },
  '.docx': {
    format: 'DOCX',
    mimeTypes: new Set([
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]),
  },
};

const GENERIC_BROWSER_MIME_TYPES = new Set(['', 'application/octet-stream']);

export function personalFolderUploadIssue(input: {
  filename: string;
  submittedMimeType: string;
  detectedFormat: DocumentFormat;
}): string | null {
  const extension = path.extname(path.basename(input.filename)).toLowerCase();
  const policy = ALLOWED_FOLDER_UPLOADS[extension];
  if (!policy)
    return 'Este cargador admite únicamente archivos PDF, DOC y DOCX.';

  const submittedMimeType = input.submittedMimeType
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (
    !policy.mimeTypes.has(submittedMimeType) &&
    !GENERIC_BROWSER_MIME_TYPES.has(submittedMimeType)
  )
    return 'El tipo declarado del archivo no coincide con un documento admitido.';

  if (input.detectedFormat !== policy.format)
    return 'La extensión del archivo no coincide con su contenido real.';

  return null;
}

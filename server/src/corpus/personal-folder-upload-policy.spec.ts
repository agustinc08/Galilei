import { describe, expect, it } from '@jest/globals';
import { personalFolderUploadIssue } from './personal-folder-upload-policy.js';

describe('personalFolderUploadIssue', () => {
  it.each([
    ['sentencia.pdf', 'application/pdf', 'PDF'],
    [
      'contrato.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'DOCX',
    ],
    ['contrato.doc', 'application/msword', 'DOC'],
  ] as const)(
    'accepts detected %s documents with matching extension and MIME',
    (filename, submittedMimeType, detectedFormat) => {
      expect(
        personalFolderUploadIssue({
          filename,
          submittedMimeType,
          detectedFormat,
        }),
      ).toBeNull();
    },
  );

  it('accepts generic browser MIME only when the detected bytes match the extension', () => {
    expect(
      personalFolderUploadIssue({
        filename: 'sentencia.pdf',
        submittedMimeType: 'application/octet-stream',
        detectedFormat: 'PDF',
      }),
    ).toBeNull();
    expect(
      personalFolderUploadIssue({
        filename: 'sentencia.pdf',
        submittedMimeType: 'application/octet-stream',
        detectedFormat: 'DOCX',
      }),
    ).toContain('contenido real');
  });

  it.each([
    ['foto.png', 'image/png', 'PDF'],
    ['archivo.zip', 'application/zip', 'DOCX'],
    ['oculto.env', 'text/plain', 'TXT'],
  ] as const)(
    'rejects unsupported file %s',
    (filename, submittedMimeType, detectedFormat) => {
      expect(
        personalFolderUploadIssue({
          filename,
          submittedMimeType,
          detectedFormat,
        }),
      ).toContain('únicamente archivos PDF, DOC y DOCX');
    },
  );

  it('rejects a MIME type that contradicts the supported extension', () => {
    expect(
      personalFolderUploadIssue({
        filename: 'sentencia.pdf',
        submittedMimeType: 'image/png',
        detectedFormat: 'PDF',
      }),
    ).toContain('tipo declarado');
  });

  it('uses only the basename when checking an upload name', () => {
    expect(
      personalFolderUploadIssue({
        filename: '..\\folder\\sentencia.pdf',
        submittedMimeType: 'application/pdf',
        detectedFormat: 'PDF',
      }),
    ).toBeNull();
  });
});

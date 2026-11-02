import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeLegacyBreaks } from '../src/lib/html-to-plain-text.ts';
import { confidenceLabel, evidenceLabel, reviewStatusLabel } from '../src/lib/review-presentation.ts';
import { formatAuditAction, formatAuditEntity, formatDateInput, maskDateInput, parseDateInput } from '../src/lib/utils.ts';

test('legacy summary breaks become safe text line breaks', () => {
  assert.equal(normalizeLegacyBreaks('Uno<br>Dos<BR />Tres'), 'Uno\nDos\nTres');
  assert.equal(normalizeLegacyBreaks('Uno &lt;br&gt; Dos'), 'Uno \n Dos');
  assert.equal(normalizeLegacyBreaks('texto &lt;script&gt;alert(1)&lt;/script&gt;'), 'texto &lt;script&gt;alert(1)&lt;/script&gt;');
});

test('editorial evidence and confidence use human labels without exposing raw fields', () => {
  assert.equal(confidenceLabel('HIGH_CONFIDENCE'), 'Coincidencia alta');
  assert.equal(reviewStatusLabel('REVIEW_PENDING'), 'Pendiente de revisión humana');
  const text = evidenceLabel({ strategies: ['EXACT_LEGACY_ID_OR_SENTENCE_NUMBER_FILENAME'] });
  assert.match(text, /identificador o número de sentencia/u);
  assert.doesNotMatch(text, /EXACT_LEGACY|strategies/u);
  assert.doesNotMatch(evidenceLabel({ internalKey: 'PRIVATE_VALUE' }), /internalKey|PRIVATE_VALUE/u);
});

test('search date inputs use day-first display and retain ISO query values', () => {
  assert.equal(formatDateInput('2024-02-29'), '29/02/2024');
  assert.equal(formatDateInput('2024-02-29T12:00:00.000Z'), '29/02/2024');
  assert.equal(maskDateInput('29022024'), '29/02/2024');
  assert.equal(maskDateInput('29/02/2024'), '29/02/2024');
  assert.equal(parseDateInput('29/02/2024'), '2024-02-29');
  assert.equal(parseDateInput('31/02/2024'), null);
  assert.equal(parseDateInput('01/03/2024'), '2024-03-01');
});

test('audit actions show operational labels instead of internal enum keys', () => {
  assert.equal(formatAuditAction('PERSONAL_DOCUMENT_DELETE'), 'Eliminar documento personal');
  assert.equal(formatAuditAction('WORKSPACE_DOCUMENT_UPLOAD'), 'Subir documento al espacio');
  assert.equal(formatAuditAction('WORKSPACE_FOLDER_DELETE'), 'Eliminar carpeta de dependencia');
  assert.equal(formatAuditAction('Workspace folder delete'), 'Eliminar carpeta de dependencia');
  assert.equal(formatAuditAction('FOLDER_CREATE'), 'Crear carpeta de dependencia');
  assert.equal(formatAuditAction('WORKSPACE_JURISPRUDENCIA_ATTACH'), 'Vincular fallo publicado con la dependencia');
  assert.doesNotMatch(formatAuditAction('WORKSPACE_FOLDER_DELETE'), /\b(?:Space|Spaces|Workspace|Workspaces)\b/iu);
  assert.doesNotMatch(formatAuditAction('WORKSPACE_JURISPRUDENCIA_ATTACH'), /\b(?:Space|Spaces|Workspace|Workspaces)\b/iu);
  assert.equal(formatAuditAction('UNKNOWN_ACTION_CODE'), 'Unknown action code');
  assert.equal(formatAuditAction(''), 'Acción sin descripción');
});

test('audit action labels observed in Office are localized and hide internal workspace terms', () => {
  const officeActions = [
    'ANONIMIZAR', 'ARCHIVAR', 'BETA_DEMO_FILENAME_ENCODING_CORRECTED', 'CREATE',
    'CREATE_DRAFT', 'DESANONIMIZAR', 'DIGESTO_LOCAL_DOCUMENT_IMPORTED',
    'DIGESTO_LOCAL_MEMBERSHIP_IMPORTED', 'DOCUMENT_MOVE', 'DRAFT_SENTENCIA_CREATED',
    'DUPLICATE_DETECTED', 'FOLDER_CREATE', 'FOLDER_RENAME',
    'JURISPRUDENCE_REVIEW_PENDING_BATCH', 'MEMBER_UPSERT', 'METADATA_CONFIRMED',
    'OCR_PILOT_COMPLETED', 'PDF_VALIDATED', 'PERSONAL_DOCUMENT_DELETE',
    'PERSONAL_FOLDER_CREATE', 'PERSONAL_UPLOAD', 'PUBLICAR', 'RESEARCH_BUNDLE_EXPORT',
    'RESTRICTED_FOLDER_CREATE', 'SENTENCIA_LINKED', 'SYNTHETIC_QA_SENTENCE_ARCHIVE',
    'UPDATE', 'UPLOAD', 'UPLOAD_RECEIVED', 'USER_ACTIVATE', 'USER_CREATE',
    'USER_DEACTIVATE', 'USER_ROLE_CHANGE', 'VISIBILITY_CHANGED',
    'WORKSPACE_DOCUMENT_DELETE', 'WORKSPACE_FOLDER_DELETE',
    'WORKSPACE_JURISPRUDENCIA_ATTACH',
  ];

  for (const action of officeActions) {
    const label = formatAuditAction(action);
    assert.notEqual(label, action, `${action} should have a human label`);
    assert.doesNotMatch(label, /\b(?:Space|Spaces|Workspace|Workspaces)\b/iu, action);
  }
});

test('audit entities show human labels for newer records', () => {
  assert.equal(formatAuditEntity('SENTENCIA'), 'Fallo');
  assert.equal(formatAuditEntity('WorkspaceDocument'), 'Documento compartido');
  assert.equal(formatAuditEntity('WorkspaceDocument', 'PERSONAL_UPLOAD'), 'Documento personal');
  assert.equal(formatAuditEntity('OcrJob'), 'Trabajo de OCR');
  assert.equal(formatAuditEntity('UnknownWorkspaceEntity'), 'Unknown workspace entity');
  assert.equal(formatAuditEntity(''), 'Entidad sin descripción');
});

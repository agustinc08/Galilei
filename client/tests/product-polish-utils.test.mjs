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
  assert.equal(formatAuditAction('UNKNOWN_ACTION_CODE'), 'Unknown action code');
  assert.equal(formatAuditAction(''), 'Acción sin descripción');
});

test('audit entities show human labels for newer records', () => {
  assert.equal(formatAuditEntity('SENTENCIA'), 'Fallo');
  assert.equal(formatAuditEntity('WorkspaceDocument'), 'Documento compartido');
  assert.equal(formatAuditEntity('WorkspaceDocument', 'PERSONAL_UPLOAD'), 'Documento personal');
  assert.equal(formatAuditEntity('OcrJob'), 'Trabajo de OCR');
  assert.equal(formatAuditEntity('UnknownWorkspaceEntity'), 'Unknown workspace entity');
  assert.equal(formatAuditEntity(''), 'Entidad sin descripción');
});

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { PDFParse } = require('pdf-parse');
const { evaluateIdentity } = require('./jurisprudencia-identity-contract.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT = path.join(ROOT, '_recovery-work', 'jurisprudencia-j2');
const J1 = path.join(ROOT, '_recovery-work', 'jurisprudencia-j1');
const AUDIT = path.join(OUT, 'first-instance-current.json');
const obj = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(OUT, name), `${JSON.stringify(value, null, 2)}\n`);
const shaText = (s) => createHash('sha256').update(s).digest('hex');
const normalizeText = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toUpperCase()
  .replace(/[^A-Z0-9]+/gu, ' ').trim().replace(/\s+/gu, ' ');
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toUpperCase().replace(/\s+/gu, ' ').trim();

function csvCell(value) { const text = String(value ?? ''); return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text; }
function keyOf(g) { return g.legalDocumentKey || ''; }
function classifyBlocker(g) {
  if (g.status === 'EXACT_DOCUMENT_MATCH') return 'NEEDS_LEGAL_IDENTITY';
  if (g.status === 'SAME_DOCUMENT_DIFFERENT_FILE') return 'NEEDS_FILE_IDENTITY';
  if (g.status === 'CANDIDATE') return 'HUMAN_JUDGMENT';
  if (g.status === 'CONFLICT' && /SAMPLED_PDF_SIGNATURE_DATE_CONTRADICTS|SHA_MATCHES_CORPUS_DOCUMENT_WITH_CONTRADICTORY/u.test(g.cause || '')) return 'METADATA_CONFLICT';
  if (g.status === 'CONFLICT') return 'MULTIPLE_CANDIDATES';
  return 'OTHER';
}
function priorityFor(category) {
  return ({ NEEDS_LEGAL_IDENTITY: 'P0', NEEDS_FILE_IDENTITY: 'P1', MULTIPLE_CANDIDATES: 'P2',
    METADATA_CONFLICT: 'P2', HUMAN_JUDGMENT: 'P3' })[category] || 'P3';
}
function getTextSignals(text) {
  const normalized = normalizeText(text);
  const upper = String(text || '').toUpperCase();
  const lines = upper.split(/\r?\n/u).map(x => x.replace(/\s+/gu, ' ').trim()).filter(x => x.length >= 24);
  const signatureLines = lines.filter(x => /FIRMADO POR|JUEZ|JUEZA|JUEZ DE CAMARA|SECRETARIO|SECRETARIA/u.test(x)).slice(-8);
  const dispositiveMarkers = ['Y VISTOS', 'SE RESUELVE', 'RESUELVE:', 'POR ELLO', 'FALLA:', 'RESUELVO'].filter(x => upper.includes(x));
  const end = upper.slice(-8000);
  const dispositive = end.match(/(?:Y VISTOS|SE RESUELVE|RESUELVE:|POR ELLO|FALLA:|RESUELVO)[\s\S]{0,1400}/u)?.[0] || '';
  return { chars: String(text || '').length, normalizedChars: normalized.length, normalizedSha256: shaText(normalized),
    firstLines: lines.slice(0, 7), dispositiveMarkers, dispositiveExcerpt: dispositive.replace(/\s+/gu, ' ').trim().slice(0, 1500), signatureLines };
}
async function pdfInfo(file) {
  if (!file || !fs.existsSync(file)) return { available: false, path: file || null };
  const bytes = fs.readFileSync(file);
  const signed = bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  if (!signed) return { available: true, path: file, bytes: bytes.length, validSignature: false };
  const parser = new PDFParse({ data: bytes });
  try {
    const text = await parser.getText();
    const info = await parser.getInfo().catch(() => ({}));
    return { available: true, path: file, bytes: bytes.length, sha256: shaText(bytes), validSignature: true,
      pages: text.pages, text: text.text || '', metadata: { title: info.info?.Title || null, pageCount: info.total || text.total || text.pages } };
  } finally { await parser.destroy(); }
}
function compareTexts(a, b) {
  const left = getTextSignals(a), right = getTextSignals(b);
  const A = new Set(normalizeText(a).split(' ').filter(x => x.length > 3));
  const B = new Set(normalizeText(b).split(' ').filter(x => x.length > 3));
  let intersection = 0; for (const token of A) if (B.has(token)) intersection++;
  const union = new Set([...A, ...B]).size;
  const ratio = union ? intersection / union : 0;
  const sameDecisionBody = left.dispositiveMarkers.some(marker => right.dispositiveMarkers.includes(marker)) && ratio >= 0.9;
  const classification = left.normalizedSha256 === right.normalizedSha256 ? 'SAME_DECISION_EQUIVALENT_RENDER'
    : sameDecisionBody ? 'SAME_DECISION_DIFFERENT_VERSION' : 'INCONCLUSIVE';
  return { classification, normalizedTextExact: left.normalizedSha256 === right.normalizedSha256,
    tokenJaccard: Number(ratio.toFixed(4)), pageCount: { left: leftPage(a), right: rightPage(b) },
    text: { left, right } };
}
function leftPage(_) { return null; }
function rightPage(_) { return null; }

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const input = obj(path.join(J1, 'review-input.json'));
  const groups = input.groups.filter(g => g.status !== 'INVALID_FILE');
  const bucket = {};
  const review = [];
  for (const group of groups) {
    const blockerCategory = classifyBlocker(group);
    bucket[blockerCategory] = (bucket[blockerCategory] || 0) + 1;
    const sources = group.sourceEvidence || [];
    const files = [...new Map(sources.filter(x => x.sha256).map(x => [x.sha256, x])).values()];
    const existing = files.filter(x => x.local_path && fs.existsSync(x.local_path));
    review.push({ groupId: keyOf(group), blockerCategory, priority: priorityFor(blockerCategory), confidence: group.confidence,
      status: group.status, cause: group.cause, caseNumber: group.caseNumber,
      year: group.decisionDate?.slice(0,4) || null, expedienteYear: group.caseNumber?.match(/\/(\d{4})$/u)?.[1] || null,
      court: group.court, chamber: group.chamber, decisionDate: group.decisionDate,
      sourceRecordIds: sources.map(x => x.external_id).filter(Boolean), candidateDocumentIds: (group.corpusDocuments || []).map(x => x.documentId),
      sourceSha: [...new Set(files.map(x => x.sha256))], sourceFilesPresent: existing.length,
      sourceFilesMissing: files.length - existing.length,
      textSimilarityEvidence: 'See same-decision-analysis.json; no text-based identity auto-write.',
      recommendation: blockerCategory === 'NEEDS_LEGAL_IDENTITY' ? 'Review decision equivalence and define a legal-decision association; preserve both file hashes.'
        : blockerCategory === 'NEEDS_FILE_IDENTITY' ? 'Compare each distinct PDF representation; do not merge file records.'
          : blockerCategory === 'METADATA_CONFLICT' ? 'Resolve source/document metadata against signed PDF evidence.'
            : blockerCategory === 'MULTIPLE_CANDIDATES' ? 'Resolve every legal identity using independent source evidence; do not use SHA as decision identity.'
              : 'Human review: source PDF exists, but no unique Corpus identity is confirmed.',
      reviewNotes: group.rationale || group.cause || '' });
  }
  write('review-blockers.json', { status: 'J2_CLASSIFIED', source: 'jurisprudencia-j1/review-input.json',
    before: 451, classified: review.length, byBlocker: bucket,
    needsAcquisition: review.filter(x=>x.sourceFilesPresent===0).length,
    sourcePdfGroupsPresent: review.filter(x=>x.sourceFilesMissing===0).length, groups: review });
  const headers = ['groupId','blockerCategory','priority','confidence','caseNumber','expedienteYear','year','court','chamber','decisionDate','sourceRecordId','candidateDocumentId','sourceSha','textSimilarityEvidence','recommendedAction','reviewNotes'];
  fs.writeFileSync(path.join(OUT, 'human-review-v2.csv'), [headers.join(','), ...review.map(x => headers.map(h => csvCell(h==='sourceRecordId'?x.sourceRecordIds.join('|'):h==='candidateDocumentId'?x.candidateDocumentIds.join('|'):h==='sourceSha'?x.sourceSha.join('|'):h==='recommendedAction'?x.recommendation:x[h])).join(','))].join('\r\n')+'\r\n');

  const localAudit = obj(AUDIT);
  const sourceResearch = {
    consultedAt: '2026-10-14',
    sources: [
      { id: 'CSJN_TFN_CURRENT', url: 'https://www.csjn.gov.ar/tribunales-federales-nacionales/inicio.html', status: 'CONFIRMED',
        scopeEvidence: 'Página oficial CSJN: buscador de fallos de Tribunales Federales y Nacionales; incluye filtros de jurisdicción, expediente, Cámara, tipo de oficina, Tribunal, carátula, palabras clave y fecha.',
        coverageEvidence: 'El Consejo de la Magistratura comunicó el 05/09/2025 la incorporación de sentencias de primera instancia conforme Acordada 10/2025; esto confirma inclusión, no exhaustividad del universo Civil.',
        dateRange: 'El instructivo público del buscador señala fecha desde 21/08/2013 (Acordada CSJN 24/2013) y remite fallos anteriores a consulta separada.',
        fieldsObserved: ['tribunal','expediente','carátula','fecha de sentencia','descargar','ver fallo'],
        pagination: 'La página expone resultados; paginación/total de hits no quedó documentada en material oficial revisado.',
        stableIds: 'No se identificó ID estable expuesto en el instructivo o en la superficie pública revisada.',
        export: 'No se encontró opción de export CSV/JSON en la interfaz/instructivo público revisado; confirmar con owner institucional.',
        pdf: 'En resultados muestreados se muestran acciones “Descargar” y “Ver Fallo”; disponibilidad es por registro y no equivale a cobertura completa.',
        auth: 'La consulta web observada es pública; no se evaluaron rutas autenticadas.',
        automationAllowed: 'NOT_ESTABLISHED: no se encontró autorización o documentación pública de API/automatización. No automatizar requests ni descargar en masa.',
        notes: 'Fuente actual prioritaria para primera instancia Civil; sólo investigación de superficie visible, sin endpoint discovery ni descarga.' },
      { id: 'PJN_PUBLIC_PORTAL', url: 'https://pjn.gov.ar/', status: 'PARTIAL',
        scopeEvidence: 'El portal PJN enlaza Consulta Jurisprudencia y la describe como búsqueda de sentencias/resoluciones judiciales; no define alcance completo Civil de primera instancia ni export.',
        dateRange: null, fieldsObserved: ['buscador jurisprudencia'], pagination: 'NOT_DOCUMENTED', stableIds: 'NOT_DOCUMENTED', export: 'NOT_DOCUMENTED',
        pdf: 'No se auditaron documentos en lote.', auth: 'La portada es pública; sin inspeccionar servicios que requieran autenticación.',
        automationAllowed: 'NOT_ESTABLISHED', notes: 'La implementación oficial de primera instancia fue observada en buscador CSJN, no se infirió equivalencia de sistemas.' },
      { id: 'CSJN_CIJ_ARCHIVE', url: 'https://www.csjn.gov.ar/archivo-cij/buscador.html', status: 'PARTIAL',
        scopeEvidence: 'Archivo histórico del CIJ declara fallos federales/nacionales y filtros por fecha y palabra; CIJ fue disuelto por Acordada 10/2025 y el sitio se conserva como repositorio histórico.',
        dateRange: 'Consulta con fechas disponibles en UI; rango histórico integral no medido.', fieldsObserved: ['fecha desde/hasta','palabras clave'],
        pagination: 'No determinado.', stableIds: 'No determinado.', export: 'No se observó export.', pdf: 'El archivo histórico muestra adjuntos en algunos resultados; cobertura Civil no determinada.',
        auth: 'Superficie pública.', automationAllowed: 'NO_GO para automatización bajo reglas vigentes del proyecto y sin autorización.',
        notes: 'No tratar el archivo como censo ni como fuente automatizable.' },
    ],
    localKnownCourts: [...new Set(localAudit.firstInstanceDocuments.map(x => x.court).filter(Boolean))],
    officialCourtRoster: 'UNKNOWN: las páginas revisadas no ofrecen un roster completo vigente cuantificado de juzgados civiles; no inventar cantidad.',
  };
  write('first-instance-source-research.json', sourceResearch);
  write('source-map.json', { asOf: '2026-10-14', localKnown: { sourceCodes: ['CIVIL_CUANTIFICACION_DANOS'], courtNames: sourceResearch.localKnownCourts,
      verifiedCorpusFirstInstanceDocuments: localAudit.counts.first_instance },
    official: sourceResearch.sources.map(({id,url,status,notes})=>({id,url,status,notes})),
    unknown: ['official complete census count','current full Civil court roster','per-record stable source ID','export contract','automation permission'] });
  write('census-schema.json', { schemaVersion: 'bjc-census-v1', source: 'string', sourceRecordId: 'string|null; stable source-native ID preferred',
    portalId: 'string|null', expediente: 'string|null; preserve original', expedienteNormalized: 'string|null; conservative normalization',
    expedienteYear: 'YYYY|null; never substitute decisionYear', decisionYear: 'YYYY|null', decisionDate: 'YYYY-MM-DD|null',
    court: 'original string|null', courtNormalized: 'controlled normalized label|null', courtType: 'FIRST_INSTANCE_CIVIL|SECOND_INSTANCE_CIVIL|UNKNOWN',
    chamber: 'string|null; null for juzgado', courtNumber: 'string|null', title: 'string|null', documentUrl: 'absolute HTTP(S)|null',
    metadataUrl: 'absolute HTTP(S)|null', retrievedAt: 'source retrieval time|null', availability: 'source status|null', metadataOriginal: 'source row preserved',
    rowNumber: 'input row number', issues: 'row-level validation codes', match: 'EXACT|HIGH|MEDIUM|LOW|CONFLICT|UNRESOLVED with reasons',
    defaultMode: 'read-only; no database, network, or file fetch', configurableColumnMapping: true });

  const identities = obj(path.join(J1, 'review-classification.json')).groups.filter(x => x.status === 'EXACT_DOCUMENT_MATCH');
  const identityPairs = [];
  for (const group of identities) {
    const source = group.sourceEvidence[0];
    const target = localAudit.targetLegalIdentityCandidates.find(x => x.id === source.corpus_document_id);
    const result = evaluateIdentity({ caseNumber: source.case_number, court: source.court, chamber: source.chamber,
      decisionDate: source.decision_date, title: source.title, sha256: source.sha256 },
    { caseNumber: target?.caseNumber, court: target?.court, chamber: target?.chamber, decisionDate: target?.decisionDate,
      title: target?.title, sha256: target?.sha256 });
    identityPairs.push({ legalDocumentKey: group.legalDocumentKey, source: { sourceRecordId: source.external_id, title: source.title,
      sha256: source.sha256, localPath: source.local_path, court: source.court, chamber: source.chamber,
      decisionDate: source.decision_date, caseNumber: source.case_number }, corpus: target ? { id: target.id, title: target.title,
        caseNumber: target.caseNumber, court: target.court, chamber: target.chamber, decisionDate: target.decisionDate,
        fileId: target.fileId, sha256: target.sha256, originalFilename: target.originalFilename, mimeType: target.mimeType,
        sizeBytes: target.sizeBytes, pageCount: target.pageCount, extractionStatus: target.extractionStatus,
        extractedChars: target.extractedChars } : null, dryRun: result });
  }
  write('identity-contract.json', { version: 'J2-dry-run-v1', identities: {
    legalDecisionIdentity: ['source-native record ID when stable','case number','issuing court','chamber when applicable','decision date','record provenance'],
    documentFileIdentity: ['SHA-256','MIME','byte length','page count','source file ID/provenance'],
    principles: ['SHA identifies exact bytes only.','A legal decision can have multiple independent file representations.','No file overwrite/deduplication for different SHA.',
      'A legal identity match with distinct SHA remains review-only until representation equivalence is resolved.'],
    model: { CorpusDocument: 'logical searchable item with legal metadata but also a generic archival record; not a strongly typed LegalDecision.',
      CorpusDocumentFile: 'supports multiple file rows per CorpusDocument via unique(documentId, sha256).',
      CorpusIngestionRecord: 'records source/provenance and optionally fileId, so multiple acquired representations can be retained.',
      Sentencia: 'legacy editable/publication/curation entity; optional legacyId and legacyLink; not a robust first-instance legal identity key.',
      CorpusDocumentLink: 'cross-domain link to external domain/type/ID; not a decision-to-file version graph.' },
    currentModelSupport: 'PARTIAL; physical representation support exists, explicit legal decision identity/representation relation is not modeled.',
    schemaChangeRequired: false, schemaChangeNow: 'NO',
    safeProposal: 'No migration now. A future write path may add a second CorpusDocumentFile to the same verified decision CorpusDocument and a distinct CorpusIngestionRecord preserving source metadata, after human approval and validating search/latest-file semantics. Otherwise add a dedicated LegalDecision identity table with representation relation after Copernic schema coordination.',
    linkerCurrentLimitation: 'CorpusIngestionService.linkExisting computes bytes SHA-256, requires exactly one CorpusDocumentFile with that SHA, errors if absent or ambiguous, then records ingestion pointing to that existing file. It cannot attach a distinct SHA representation to a legally identical CorpusDocument.',
    v2: { dryRunOnly: true, writes: 0, fields: ['confidence','legalIdentityMatch','fileIdentityMatch','reasons','allowedAction'], realCases: identityPairs },
  }});
  write('same-decision-analysis.json', { status: 'PENDING_TEXT_COMPARE', note: 'Comparison details are appended by the PDF analysis step.', pairs: identityPairs });
  write('acquisition-manifest.json', { source: 'CSJN Tribunales Federales y Nacionales', status: 'NOT_STARTED_NO_DOCUMENTED_AUTOMATION_PERMISSION',
    records: [], attemptedDownloads: 0, limit: 20, note: '0 download is correct until an authorized stable export/API or manual package is supplied.' });
  write('coverage-first-instance.json', { denominator: 'UNKNOWN', known: null, matched: null, unmatched: null, review: null,
    localKnownDocuments: localAudit.counts.first_instance, canClaimTotalCoverage: false,
    dimensions: ['decisionYear','courtNormalized','source'], censusSupport: 'CSV/JSON adapter emits matched/unmatched/review/noDocument/unavailable by year, court and source.',
    note: 'The one local first-instance Corpus record is not an official census and cannot be used as a coverage denominator.' });

  const request = `# Solicitud técnica: censo/export de jurisprudencia Civil de primera instancia\n\n`+
    `**Estado:** borrador preparado; no enviado. **Fecha de investigación:** 14/10/2026.\n\n`+
    `Solicitamos confirmar si existe un mecanismo institucional autorizado de exportación del buscador de Tribunales Federales y Nacionales para sentencias de los Juzgados Nacionales en lo Civil de primera instancia. El anuncio oficial de incorporación de sentencias de primera instancia confirma que el universo se consulta en la interfaz pública, pero no documenta exhaustividad, exportación, IDs ni permisos de automatización.\n\n`+
    `## Alcance solicitado\n\n`+
    `- Sólo sentencias/resoluciones civiles de juzgados nacionales de primera instancia de Capital Federal, con fecha de corte explícita y rango histórico disponible.\n`+
    `- Incluir todos los órganos vigentes e históricos dentro del alcance y describir exclusiones, publicaciones no indexadas, reserva/anonimización y retención.\n`+
    `- Informar el total de registros por órgano y año, y si el total representa el universo completo o únicamente lo publicado.\n\n`+
    `## Campos mínimos por registro\n\n`+
    `1. ID estable del registro y, si difiere, ID de portal.\n2. Fuero/jurisdicción, instancia y órgano original.\n3. Número de juzgado y secretaría cuando consten; Sala debe quedar nula en primera instancia.\n4. Expediente original, expediente normalizado si lo proporciona el sistema y año de expediente separado del año/fecha de decisión.\n5. Fecha de decisión, carátula y tipo de resolución.\n6. URL de metadata, URL del documento y estado de disponibilidad/visibilidad.\n7. Fecha de publicación/modificación, fuente, fecha de extracción y explicación de duplicados/reemplazos.\n\n`+
    `## Formato y operación\n\n`+
    `Preferimos CSV UTF-8 o JSON con esquema y diccionario de datos; solicitar hash/checksum, codificación, paginación/total, reglas de actualización incremental, licencia/condiciones de reutilización, autorización expresa de descarga/automatización y contacto para incidencias. Si no se puede entregar un archivo, proponer un canal institucional de paquete seguro con la misma procedencia. No solicitamos credenciales personales ni acceso a causas restringidas.\n\n`+
    `## Validación de entrega\n\n`+
    `Acompañar un conteo de control por año y juzgado, fecha de corte, total de filas/IDs únicos, lista de órganos incluidos, tratamiento de PDFs faltantes y muestra de hasta 20 filas/documentos permitidos para validar el importador y la salud PDF. No se iniciará adquisición masiva hasta confirmar alcance, permiso, estabilidad del método y límites de tasa.\n`;
  fs.writeFileSync(path.join(OUT, 'authorized-export-request.md'), request);
  write('final-summary.json', { status: 'IN_PROGRESS', asOf: '2026-10-14', inputGroups: input.heldLegalGroups,
    classifiedReviewGroups: review.length, reviewByBlocker: bucket, localAudit: { counts: localAudit.counts,
      firstInstanceDocuments: localAudit.firstInstanceDocuments.length, secondInstanceFirstInstanceEvidenceCount: localAudit.secondInstanceEvidenceCount },
    testArtifacts: ['census-import-test.json'], searchVerifyArtifactPending: true });
}

main().catch(error => { console.error(`J2_ARTIFACT_BUILD_FAILED: ${error.stack || error.message}`); process.exitCode = 1; });

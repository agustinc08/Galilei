'use strict';

const crypto = require('node:crypto');

const STATUSES = Object.freeze([
  'CERTIFIED',
  'CERTIFIED_WITH_KNOWN_GAP',
  'HUMAN_REVIEW_PENDING',
  'MODEL_LIMITATION',
  'UNRESOLVED',
  'BROKEN',
  'UNKNOWN',
]);

function stable(value) {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function classifyDocument(input) {
  const brokenReasons = [];
  const unknownReasons = [];
  const unresolvedReasons = [];
  const knownGaps = [...(input.knownGaps || [])];
  const modelLimitations = [...(input.modelLimitations || [])];

  if (input.fileIntegrity !== 'VALID') brokenReasons.push(`FILE_${input.fileIntegrity || 'UNKNOWN'}`);
  if (input.provenance !== 'COMPLETE') {
    if (input.provenance === 'UNKNOWN') unknownReasons.push('PROVENANCE_UNKNOWN');
    else brokenReasons.push(`PROVENANCE_${input.provenance || 'MISSING'}`);
  }
  if (input.pageIntegrity === 'BROKEN') brokenReasons.push('PAGE_INTEGRITY_FAILURE');
  if (input.pageIntegrity === 'UNKNOWN') unknownReasons.push('PAGE_INTEGRITY_UNKNOWN');
  if (input.search === 'BROKEN') brokenReasons.push('SEARCH_UNEXPECTEDLY_UNAVAILABLE');
  if (input.search === 'UNKNOWN') unknownReasons.push('SEARCH_STATE_UNKNOWN');
  if (input.viewer === 'FILE_MISSING' || input.viewer === 'BROKEN') brokenReasons.push('VIEWER_FILE_UNAVAILABLE');
  else if (input.viewer === 'UNKNOWN') unknownReasons.push('VIEWER_STATE_UNKNOWN');
  if (input.sourceStatus === 'UNKNOWN') unknownReasons.push('SOURCE_UNKNOWN');
  if (input.sourceStatus === 'CONFLICTING') unresolvedReasons.push('SOURCE_CONFLICT');
  if (input.identityStatus === 'UNKNOWN') unknownReasons.push('IDENTITY_UNKNOWN');
  if (input.identityStatus === 'UNRESOLVED') unresolvedReasons.push('IDENTITY_UNRESOLVED');

  const certificationStatus = brokenReasons.length ? 'BROKEN'
    : unknownReasons.length ? 'UNKNOWN'
      : unresolvedReasons.length ? 'UNRESOLVED'
        : input.humanReviewRequired ? 'HUMAN_REVIEW_PENDING'
          : modelLimitations.length ? 'MODEL_LIMITATION'
            : knownGaps.length ? 'CERTIFIED_WITH_KNOWN_GAP'
              : 'CERTIFIED';

  const reasons = [...brokenReasons, ...unknownReasons, ...unresolvedReasons,
    ...(input.humanReviewRequired ? ['HISTORICAL_SALA_HUMAN_REVIEW_PENDING'] : []),
    ...modelLimitations, ...knownGaps];
  return {
    certificationStatus,
    certificationReason: reasons.length ? [...new Set(reasons)].sort() : ['ALL_TECHNICAL_GATES_PASS'],
    knownGaps: [...new Set(knownGaps)].sort(),
    modelLimitations: [...new Set(modelLimitations)].sort(),
    brokenReasons,
    unknownReasons,
    unresolvedReasons,
  };
}

function buildManifest(rows) {
  return rows.map(row => {
    const state = classifyDocument(row.certificationInput);
    return {
      documentId: row.documentId,
      source: row.source,
      decisionDate: row.decisionDate,
      fileIntegrity: row.fileIntegrity,
      fileSha: row.fileSha,
      provenanceStatus: row.provenance,
      pageStatus: row.pageStatus,
      emptyPageCounts: row.emptyPageCounts || {},
      searchStatus: row.search,
      viewerStatus: row.viewer,
      caseNormalizationStatus: row.caseNormalizationStatus,
      salaStatus: row.salaStatus,
      legalKeyStatus: row.legalKeyStatus,
      representationStatus: row.representationStatus,
      qualityFlags: row.qualityFlags || [],
      certificationStatus: state.certificationStatus,
      certificationReason: state.certificationReason,
      knownGaps: state.knownGaps,
      humanReviewRequired: Boolean(row.humanReviewRequired),
      modelLimitation: state.modelLimitations,
      recommendedFutureAction: row.recommendedFutureAction || null,
    };
  }).sort((a, b) => a.documentId.localeCompare(b.documentId));
}

function validateManifest(manifest, expectedCount) {
  const ids = manifest.map(row => row.documentId);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  const missingIdCount = ids.filter(id => !id).length;
  const counts = Object.fromEntries(STATUSES.map(status => [status, manifest.filter(row => row.certificationStatus === status).length]));
  const badStatuses = manifest.filter(row => !STATUSES.includes(row.certificationStatus)).map(row => row.documentId);
  return {
    expected: expectedCount,
    entries: manifest.length,
    uniqueIds: new Set(ids).size,
    duplicates: duplicateIds.length,
    missingIds: missingIdCount,
    badStatuses,
    statusCounts: counts,
    reconciles: manifest.length === expectedCount && new Set(ids).size === expectedCount && !duplicateIds.length && !missingIdCount && !badStatuses.length && Object.values(counts).reduce((a, b) => a + b, 0) === expectedCount,
  };
}

function chooseSearchSample(rows, limit = 100) {
  const ordered = [...rows].sort((a, b) => sha256(a.documentId).localeCompare(sha256(b.documentId)) || a.documentId.localeCompare(b.documentId));
  const chosen = [];
  const seen = new Set();
  const add = row => {
    if (!row || seen.has(row.documentId) || chosen.length >= limit) return;
    seen.add(row.documentId);
    chosen.push(row);
  };
  const dimensions = [
    row => row.source,
    row => String(row.decisionDate || '').slice(0, 4),
    row => row.sala || '(unknown)',
    row => row.fileKind,
    row => row.qualityBand,
    row => row.certificationStatus,
  ];
  for (const dimension of dimensions) {
    const buckets = new Map();
    for (const row of ordered) {
      const key = dimension(row) || '(unknown)';
      if (!buckets.has(key)) buckets.set(key, row);
    }
    for (const row of buckets.values()) add(row);
  }
  for (const row of ordered) add(row);
  return chosen;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function renderHtml(certificate, manifest) {
  const statuses = STATUSES.map(status => `<option>${escapeHtml(status)}</option>`).join('');
  const sources = [...new Set(manifest.map(row => row.source))].sort();
  const sourceOptions = sources.map(source => `<option>${escapeHtml(source)}</option>`).join('');
  const rows = manifest.map(row => `<tr data-status="${escapeHtml(row.certificationStatus)}" data-source="${escapeHtml(row.source)}" data-year="${escapeHtml(String(row.decisionDate || '').slice(0, 4))}" data-sala="${escapeHtml(row.salaStatus)}" data-viewer="${escapeHtml(row.viewerStatus)}" data-gap="${escapeHtml(row.knownGaps.join(' '))}" data-human="${row.humanReviewRequired ? 'yes' : 'no'}"><td>${escapeHtml(row.documentId)}</td><td>${escapeHtml(row.source)}</td><td>${escapeHtml(String(row.decisionDate || '').slice(0, 10))}</td><td>${escapeHtml(row.salaStatus)}</td><td>${escapeHtml(row.viewerStatus)}</td><td><strong>${escapeHtml(row.certificationStatus)}</strong></td><td>${escapeHtml([...row.knownGaps, ...row.modelLimitation].join(', '))}</td></tr>`).join('');
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Certificación del Corpus Civil</title><style>body{font:15px/1.45 system-ui,Segoe UI,sans-serif;color:#17313b;background:#f2f6f7;margin:0}header{background:#12313a;color:#fff;padding:28px max(24px,calc((100vw - 1400px)/2))}main{max-width:1400px;margin:24px auto;padding:0 20px}.cards{display:flex;gap:12px;flex-wrap:wrap}.card,section{background:#fff;border:1px solid #d6e1e5;border-radius:12px;padding:18px;margin-bottom:16px}.card{min-width:145px}.card b{display:block;font-size:24px}.filters{display:flex;gap:10px;flex-wrap:wrap}select,input{padding:10px;border:1px solid #bdcbd1;border-radius:7px;background:#fff}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:9px;border-bottom:1px solid #e2e8eb}th{position:sticky;top:0;background:#edf3f5}.tablewrap{max-height:65vh;overflow:auto}.gap{color:#7b4a08}.status{display:inline-block;background:#deeceb;padding:3px 8px;border-radius:99px}.note{color:#49616b}</style><header><h1>Certificación del Corpus Civil</h1><p>Alcance: corpus Civil actualmente adquirido por Galilei. No afirma cobertura total de la jurisprudencia Civil.</p></header><main><section class="cards"><div class="card">Documentos<b>${certificate.snapshot.civilDocuments}</b></div><div class="card">Con estado explícito<b>${certificate.documentCoverage.coveragePercent}%</b></div><div class="card">BROKEN<b>${certificate.states.BROKEN}</b></div><div class="card">UNKNOWN<b>${certificate.states.UNKNOWN}</b></div><div class="card">Search listo (texto)<b>${certificate.search.searchReady}</b></div><div class="card">Sala conocida<b>${certificate.sala.known}</b></div></section><section><h2>Conclusión</h2><p><span class="status">${escapeHtml(certificate.globalStatus)}</span></p><p>${escapeHtml(certificate.conclusion)}</p><p class="note">Las revisiones humanas pendientes y los gaps históricos están identificados por separado de la integridad técnica.</p></section><section><h2>Filtrar manifiesto</h2><div class="filters"><select id="status"><option value="">Todos los estados</option>${statuses}</select><select id="source"><option value="">Todas las fuentes</option>${sourceOptions}</select><input id="year" placeholder="Año"><input id="sala" placeholder="Estado Sala"><input id="viewer" placeholder="Estado Viewer"><label><input type="checkbox" id="human"> Revisión humana</label><input id="gap" placeholder="Gap contiene"></div></section><section class="tablewrap"><table><thead><tr><th>Document ID</th><th>Fuente</th><th>Fecha</th><th>Sala</th><th>Viewer</th><th>Certificación</th><th>Gap / limitación</th></tr></thead><tbody id="rows">${rows}</tbody></table></section></main><script>const filterStatus=document.getElementById('status'),filterSource=document.getElementById('source'),filterYear=document.getElementById('year'),filterSala=document.getElementById('sala'),filterViewer=document.getElementById('viewer'),filterHuman=document.getElementById('human'),filterGap=document.getElementById('gap');const controls=[filterStatus,filterSource,filterYear,filterSala,filterViewer,filterHuman,filterGap];function apply(){for(const row of document.querySelectorAll('#rows tr')){const ok=(!filterStatus.value||row.dataset.status===filterStatus.value)&&(!filterSource.value||row.dataset.source===filterSource.value)&&(!filterYear.value||row.dataset.year.includes(filterYear.value))&&(!filterSala.value||row.dataset.sala.toLowerCase().includes(filterSala.value.toLowerCase()))&&(!filterViewer.value||row.dataset.viewer.toLowerCase().includes(filterViewer.value.toLowerCase()))&&(!filterHuman.checked||row.dataset.human==='yes')&&(!filterGap.value||row.dataset.gap.toLowerCase().includes(filterGap.value.toLowerCase()));row.hidden=!ok}}controls.forEach(el=>el.addEventListener('input',apply));</script></html>`;
}

module.exports = { STATUSES, stable, sha256, classifyDocument, buildManifest, validateManifest, chooseSearchSample, renderHtml };

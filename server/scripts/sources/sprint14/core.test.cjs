'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyCivil,
  incrementalStatus,
  parseCijSitemap,
  parseCsjnTomoCatalog,
  parseOpenDataSearch,
  reconcileDocument,
  validatePdf,
} = require('./core.cjs');

test('parses tomo labels and resource links from the official catalogue markup', () => {
  const html = `<div class="row"><div class="row">
    <div><span>349-I</span></div><div><span>2026</span></div>
    <div><span>&nbsp;</span></div><a class="linkTomo" href="/sj/verTomo?tomoId=383"><i></i></a>
  </div></div>`;
  assert.deepEqual(parseCsjnTomoCatalog(html), [{
    sourceId: '383', volume: '349-I', year: '2026',
    resourceUrl: 'https://sjservicios.csjn.gov.ar/sj/verTomo?tomoId=383',
  }]);
});

test('parses only loc entries from a CIJ sitemap and labels news versus unknown routes', () => {
  const sitemap = `<urlset><url><loc>http://cij7.test:8081/</loc></url>
    <url><loc>http://cij7.test:8081/nota-123-Caso.html</loc></url>
    <url><loc>https://www.cij.gov.ar/otro.html</loc></url></urlset>`;
  const result = parseCijSitemap(sitemap);
  assert.equal(result.length, 3);
  assert.deepEqual(result.map((row) => row.category), ['HOME', 'NEWS_NOTA', 'OTHER']);
  assert.equal(result[1].host, 'cij7.test:8081');
});

test('reports an empty public data catalogue query without inventing resources', () => {
  const parsed = parseOpenDataSearch('<main><p>307 datasets</p><p>Lo sentimos, no se encontraron datasets para "fallos"</p></main>');
  assert.equal(parsed.portalDatasetCount, 307);
  assert.equal(parsed.noResults, true);
  assert.match(parsed.responseSha256, /^[a-f0-9]{64}$/);
});

test('classifies exact court and structured case evidence; a bare word remains a candidate', () => {
  assert.equal(classifyCivil({ court: 'Cámara Nacional de Apelaciones en lo Civil' }).classification, 'CIVIL_EXACT');
  assert.equal(classifyCivil({ court: 'Cámara Nacional de Apelaciones en lo Civil, Sala A' }).classification, 'CIVIL_EXACT');
  assert.equal(classifyCivil({ court: 'Cámara Nacional de Apelaciones en lo Civil y Comercial Federal' }).classification, 'CIVIL_CANDIDATE');
  assert.equal(classifyCivil({ caseNumber: 'CIV 1234/2024' }).classification, 'CIVIL_HIGH_CONFIDENCE');
  assert.equal(classifyCivil({ title: 'Responsabilidad civil por daños' }).classification, 'CIVIL_CANDIDATE');
  assert.equal(classifyCivil({ court: 'Cámara Nacional de Apelaciones en lo Penal' }).classification, 'NON_CIVIL');
  assert.equal(classifyCivil({ title: 'Sin materia estructurada' }).classification, 'UNRESOLVED');
});

test('distinguishes exact byte duplicates from legal-document candidates', () => {
  assert.deepEqual(reconcileDocument({ sha256: 'ab' }, { sha256: 'AB' }), { match: 'EXACT_SHA256', automaticLinkAllowed: true });
  assert.deepEqual(reconcileDocument(
    { caseNumber: 'CIV 5/20', court: 'Juzgado Civil', decisionDate: '2020-01-01', title: 'Caso A', sha256: 'aa' },
    { caseNumber: 'CIV 5/20', court: 'Juzgado Civil', decisionDate: '2020-01-01', title: 'Caso A', sha256: 'bb' },
  ), { match: 'LEGAL_DOCUMENT_CANDIDATE', automaticLinkAllowed: false });
});

test('preserves incremental source versions and never deletes a missing source locally', () => {
  assert.equal(incrementalStatus({ externalId: '1', sha256: 'new' }, { externalId: '1', sha256: 'old' }), 'SOURCE_DOCUMENT_CHANGED');
  assert.equal(incrementalStatus(null, { externalId: '1' }), 'SOURCE_MISSING_RETAIN_LOCAL');
  assert.equal(incrementalStatus({ externalId: '2' }, null), 'NEW_DOCUMENT');
  assert.equal(incrementalStatus(null, null), 'UNCHANGED');
});

test('verifies PDF magic and EOF with a deterministic checksum', () => {
  const good = validatePdf(Buffer.from('%PDF-1.4\nfixture\n%%EOF\n'));
  assert.equal(good.valid, true);
  assert.equal(good.hasPdfMagic, true);
  assert.equal(good.hasEofMarker, true);
  assert.equal(validatePdf(Buffer.from('<html>not a pdf</html>')).valid, false);
});

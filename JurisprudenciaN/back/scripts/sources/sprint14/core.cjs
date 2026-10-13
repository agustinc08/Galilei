'use strict';

const crypto = require('node:crypto');

function htmlText(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCsjnTomoCatalog(html, baseUrl = 'https://sjservicios.csjn.gov.ar') {
  const source = String(html);
  const entries = [];
  const links = /<a\b(?=[^>]*\bclass=["'][^"']*\blinkTomo\b[^"']*["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = links.exec(source))) {
    const rowStart = source.lastIndexOf('<div class="row">', match.index);
    const row = rowStart < 0 ? '' : source.slice(rowStart, match.index);
    const cells = [...row.matchAll(/<span\b[^>]*>(.*?)<\/span>/gis)].map((cell) => htmlText(cell[1]));
    const href = new URL(match[1], baseUrl).toString();
    const id = new URL(href).searchParams.get('tomoId');
    if (!id || !/^\d+$/.test(id)) continue;
    entries.push({
      sourceId: id,
      volume: cells[0] ?? '',
      year: cells[1] ?? '',
      resourceUrl: href,
    });
  }
  return entries;
}

function parseCijSitemap(xml) {
  return [...String(xml).matchAll(/<loc>\s*(.*?)\s*<\/loc>/gis)]
    .map((match) => htmlText(match[1]))
    .filter((url) => /^https?:\/\//i.test(url))
    .map((url) => {
      const parsed = new URL(url);
      return {
        url,
        host: parsed.host,
        path: parsed.pathname,
        category: parsed.pathname === '/' ? 'HOME'
          : parsed.pathname === '/informacion.html' ? 'INFORMATION'
            : /^\/nota-\d+/.test(parsed.pathname) ? 'NEWS_NOTA' : 'OTHER',
      };
    });
}

function parseOpenDataSearch(html) {
  const text = htmlText(String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, ' '));
  const count = text.match(/\b(\d+)\s+datasets\b/i);
  const noResults = /no se encontraron datasets/i.test(text);
  return {
    portalDatasetCount: count ? Number(count[1]) : null,
    noResults,
    responseSha256: crypto.createHash('sha256').update(String(html), 'utf8').digest('hex'),
  };
}

function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-AR').replace(/[^a-z0-9]+/g, ' ').trim();
}

const CIVIL_COURT_PATTERNS = [
  /^camara nacional de apelaciones en lo civil(?: sala [a-z])?$/,
  /^camara nacional civil(?: sala [a-z])?$/,
  /^juzgado nacional en lo civil(?: n \d+| numero \d+)?$/,
  /^juzgado nacional civil(?: n \d+| numero \d+)?$/,
];
const NON_CIVIL_COURT_PATTERNS = [
  /\bpenal\b/, /\blaboral\b/, /\bcontencioso administrativo\b/, /\belectoral\b/,
];

function classifyCivil(record = {}) {
  const court = normalize(record.court ?? record.normalizedCourt ?? '');
  const subject = normalize(record.officialSubject ?? record.subject ?? '');
  const caseNumber = normalize(record.caseNumber ?? record.expediente ?? '');
  const text = normalize([record.title, record.summary, record.text].filter(Boolean).join(' '));
  const evidence = [];
  if (CIVIL_COURT_PATTERNS.some((pattern) => pattern.test(court))) {
    evidence.push('EXACT_CIVIL_COURT');
    return { classification: 'CIVIL_EXACT', score: 100, evidence };
  }
  if (subject === 'derecho civil' || subject === 'materia civil' || subject === 'civil') {
    evidence.push('OFFICIAL_STRUCTURED_SUBJECT');
    return { classification: 'CIVIL_HIGH_CONFIDENCE', score: 85, evidence };
  }
  if (/^(civ|civcom|civ y com)\b/.test(caseNumber)) {
    evidence.push('CIVIL_CASE_PREFIX');
    return { classification: 'CIVIL_HIGH_CONFIDENCE', score: 80, evidence };
  }
  if (NON_CIVIL_COURT_PATTERNS.some((pattern) => pattern.test(court))) {
    evidence.push('EXPLICIT_NON_CIVIL_COURT');
    return { classification: 'NON_CIVIL', score: 100, evidence };
  }
  if (/\bcivil\b/.test(`${court} ${subject} ${caseNumber} ${text}`)) {
    evidence.push('CIVIL_TERM_ONLY');
    return { classification: 'CIVIL_CANDIDATE', score: 35, evidence };
  }
  return { classification: 'UNRESOLVED', score: 0, evidence };
}

function reconcileDocument(incoming = {}, local = {}) {
  if (incoming.sha256 && local.sha256 && incoming.sha256.toLowerCase() === local.sha256.toLowerCase()) {
    return { match: 'EXACT_SHA256', automaticLinkAllowed: true };
  }
  if (incoming.sourceCode && incoming.sourceCode === local.sourceCode
      && incoming.externalId && incoming.externalId === local.externalId) {
    return { match: 'EXTERNAL_ID_MATCH', automaticLinkAllowed: true };
  }
  const sameCase = normalize(incoming.caseNumber) && normalize(incoming.caseNumber) === normalize(local.caseNumber);
  const sameCourt = normalize(incoming.court) && normalize(incoming.court) === normalize(local.court);
  const sameDate = incoming.decisionDate && incoming.decisionDate === local.decisionDate;
  const sameTitle = normalize(incoming.title) && normalize(incoming.title) === normalize(local.title);
  if (sameCase && sameCourt && (sameDate || sameTitle)) {
    return { match: 'LEGAL_DOCUMENT_CANDIDATE', automaticLinkAllowed: false };
  }
  return { match: 'UNRESOLVED', automaticLinkAllowed: false };
}

function incrementalStatus(current, previous) {
  if (!current && !previous) return 'UNCHANGED';
  if (!current && previous) return 'SOURCE_MISSING_RETAIN_LOCAL';
  if (current && !previous) return 'NEW_DOCUMENT';
  if (current.externalId === previous.externalId && current.sha256 !== previous.sha256) return 'SOURCE_DOCUMENT_CHANGED';
  if (current.externalId === previous.externalId && current.metadataSha256 !== previous.metadataSha256) return 'SOURCE_METADATA_CHANGED';
  return 'UNCHANGED';
}

function validatePdf(bytes) {
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? '');
  const head = data.subarray(0, 5).toString('ascii');
  const tail = data.subarray(Math.max(0, data.length - 4096)).toString('latin1');
  return {
    valid: data.length > 0 && head === '%PDF-' && tail.includes('%%EOF'),
    sizeBytes: data.length,
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
    hasPdfMagic: head === '%PDF-',
    hasEofMarker: tail.includes('%%EOF'),
  };
}

module.exports = {
  classifyCivil,
  incrementalStatus,
  parseCijSitemap,
  parseCsjnTomoCatalog,
  parseOpenDataSearch,
  reconcileDocument,
  validatePdf,
};

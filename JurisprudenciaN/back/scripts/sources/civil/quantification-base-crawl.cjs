'use strict';

// Public, resumable acquisition from the PJN Civil Chamber's visible
// quantification search and its ordinary "Ver sentencia" viewer chain.
// No credentials, CAPTCHA tokens, hidden APIs, or ID enumeration are used.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const BACK = path.join(ROOT, 'JurisprudenciaN', 'back');
const WORK = path.join(ROOT, '_recovery-work', 'sprint144', 'quantification');
const DB_PATH = path.join(WORK, 'checkpoint.sqlite');
const BASE = 'http://consultas.pjn.gov.ar/cuantificacion/civil/';
const ALLOWED_VIEWER_HOST = 'scw.pjn.gov.ar';
const SOURCE_CODE = 'CIVIL_CUANTIFICACION_DANOS';
const UA = 'BuscadorJuridicoCivil/14.4 (+public research; sequential requests)';
const FORMS = [
  ['VALOR_VIDA_PRE_2015', 'vida_ppal.php', 'vida_avanzada_frm.php', 'vida_result.php'],
  ['VALOR_VIDA_POST_2015', 'vida_ppal.php', 'vida_po_avanzada_frm.php', 'vida_po_result.php'],
  ['LESIONES_PRE_2015', 'lesiones_ppal.php', 'lesiones_avanzada_frm.php', 'lesiones_result.php'],
  ['LESIONES_POST_2015', 'lesiones_ppal.php', 'lesiones_po_avanzada_frm.php', 'lesiones_po_result.php'],
  ['DANO_MORAL', 'dmoral_ppal.php', 'dmoral_avanzada_frm.php', 'dmoral_result.php'],
  ['DANO_EXTRAPATRIMONIAL', 'dmoral_ppal.php', 'dextrapa_avanzada_frm.php', 'dextrapa_result.php'],
  ['RESP_SALUD_LESIONES_PRE_2015', 'resp_medica_ppal.php', 'resp_medica_le_avanzada_ant_frm.php', 'resp_medica_le_result_ant.php'],
  ['RESP_SALUD_LESIONES_POST_2015', 'resp_medica_ppal.php', 'resp_medica_le_avanzada_frm.php', 'resp_medica_le_result.php'],
  ['RESP_SALUD_FALLECIMIENTO_PRE_2015', 'resp_medica_ppal.php', 'resp_medica_fa_avanzada_ant_frm.php', 'resp_medica_fa_result_ant.php'],
  ['RESP_SALUD_FALLECIMIENTO_POST_2015', 'resp_medica_ppal.php', 'resp_medica_fa_avanzada_frm.php', 'resp_medica_fa_result.php'],
  ['VIOLENCIA_MUJER', 'violencia_mujer_ppal.php', 'violencia_mujer_avanzada_frm.php', 'violencia_mujer_result.php'],
  ['VIOLENCIA_FAMILIAR_MUJER', 'violencia_mujer_ppal.php', 'violencia_f_mujer_avanzada_frm.php', 'violencia_f_mujer_result.php'],
];

const args = new Map(process.argv.slice(2).filter(x => x.startsWith('--')).map(x => {
  const i = x.indexOf('='); return i < 0 ? [x.slice(2), true] : [x.slice(2, i), x.slice(i + 1)];
}));
const mode = args.get('mode') || (args.has('download') ? 'download' : 'discover');
const delayMs = Math.max(0, Number(args.get('delay-ms') || 1000));
const maxQueries = Number(args.get('max-queries') || 0);
const maxRecords = Number(args.get('max-records') || 0);
const batchSize = Math.max(1, Number(args.get('batch-size') || 25));
const concurrency = Math.max(1, Math.min(4, Number(args.get('concurrency') || 1)));
const categoryFilter = args.get('category') || null;
const sourceKeyFilter = args.get('source-key') || null;
const doImport = args.has('import');
const retryMetadata = args.has('retry-metadata');
const retryHuman = args.has('retry-human');
const skipViewer = args.has('skip-viewer');

function htmlDecode(value) {
  const named = { nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>',
    aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
    Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
    ntilde: 'ñ', Ntilde: 'Ñ',uuml: 'ü', Uuml: 'Ü',
    iexcl: '¡', iquest: '¿', cent: '¢', pound: '£', euro: '€',
    ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };
  return String(value || '').replace(/&([a-z]+);/gi, (entity, name) => named[name] ?? entity)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function stripHtml(value) { return htmlDecode(String(value || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function pause() { return new Promise(resolve => setTimeout(resolve, delayMs)); }
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function isVerifiedPdf(status, mimeType, bytes) {
  return status === 200 && /^application\/pdf(?:\s*;|$)/i.test(mimeType || '')
    && bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-';
}
function sameSiteUrl(raw, pageUrl) {
  const url = new URL(htmlDecode(raw), pageUrl);
  if (url.hostname !== new URL(BASE).hostname || !url.pathname.startsWith('/cuantificacion/civil/')) throw new Error(`OUT_OF_SCOPE_SOURCE_URL:${url.origin}${url.pathname}`);
  return url;
}

fs.mkdirSync(WORK, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS searches (
  query_key TEXT PRIMARY KEY, category TEXT NOT NULL, form_url TEXT NOT NULL,
  result_url TEXT NOT NULL, sala TEXT, status TEXT NOT NULL DEFAULT 'PENDING',
  http_status INTEGER, result_count INTEGER, detail_links INTEGER, captured_at TEXT,
  error TEXT
);
CREATE TABLE IF NOT EXISTS records (
  source_key TEXT PRIMARY KEY, category TEXT NOT NULL, search_key TEXT NOT NULL,
  detail_url TEXT NOT NULL, case_record_id TEXT, case_number TEXT, title TEXT,
  decision_date TEXT, lower_decision_date TEXT, chamber TEXT, first_instance_court TEXT,
  pdf_url TEXT, detail_status TEXT NOT NULL DEFAULT 'DISCOVERED', pdf_status TEXT NOT NULL DEFAULT 'NOT_ATTEMPTED',
  corpus_status TEXT NOT NULL DEFAULT 'NOT_IMPORTED',
  http_status INTEGER, mime_type TEXT, byte_size INTEGER, sha256 TEXT, file_path TEXT,
  error TEXT, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS records_sha_idx ON records(sha256);
CREATE INDEX IF NOT EXISTS records_case_idx ON records(case_number, decision_date);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);

// Additive checkpoint migrations preserve all discovery and PDF receipts.
const recordColumns = new Set(db.prepare('PRAGMA table_info(records)').all().map(row => row.name));
for (const [name, type] of [['metadata_json', 'TEXT'], ['document_text', 'TEXT']]) {
  if (!recordColumns.has(name)) db.exec(`ALTER TABLE records ADD COLUMN ${name} ${type}`);
}

const qGet = db.prepare('SELECT * FROM searches WHERE query_key=?');
const qPut = db.prepare(`INSERT INTO searches(query_key,category,form_url,result_url,sala,status,http_status,result_count,detail_links,captured_at,error)
 VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(query_key) DO UPDATE SET status=excluded.status,http_status=excluded.http_status,result_count=excluded.result_count,detail_links=excluded.detail_links,captured_at=excluded.captured_at,error=excluded.error`);
const rGet = db.prepare('SELECT * FROM records WHERE source_key=?');
const rPut = db.prepare(`INSERT INTO records(source_key,category,search_key,detail_url,case_record_id,first_seen_at,last_seen_at)
 VALUES(?,?,?,?,?,?,?) ON CONFLICT(source_key) DO UPDATE SET category=excluded.category,search_key=excluded.search_key,detail_url=excluded.detail_url,last_seen_at=excluded.last_seen_at`);
const rPatch = db.prepare(`UPDATE records SET case_record_id=COALESCE(?,case_record_id),case_number=COALESCE(?,case_number),title=COALESCE(?,title),decision_date=COALESCE(?,decision_date),lower_decision_date=COALESCE(?,lower_decision_date),chamber=COALESCE(?,chamber),first_instance_court=COALESCE(?,first_instance_court),pdf_url=COALESCE(?,pdf_url),detail_status=?,pdf_status=COALESCE(?,pdf_status),http_status=COALESCE(?,http_status),mime_type=COALESCE(?,mime_type),byte_size=COALESCE(?,byte_size),sha256=COALESCE(?,sha256),file_path=COALESCE(?,file_path),error=?,metadata_json=COALESCE(?,metadata_json),document_text=COALESCE(?,document_text) WHERE source_key=?`);

let cookie = '';
async function request(url, options = {}, allowViewer = false) {
  let target = new URL(url);
  let method = options.method || 'GET';
  let body = options.body;
  for (let redirects = 0; redirects <= 5; redirects++) {
    const allowed = target.hostname === new URL(BASE).hostname || (allowViewer && target.hostname === ALLOWED_VIEWER_HOST);
    if (!allowed || !['http:', 'https:'].includes(target.protocol)) throw new Error(`BLOCKED_HOST:${target.origin}`);
    const headers = { 'user-agent': UA, accept: 'text/html,application/pdf;q=0.9,*/*;q=0.5', ...(options.headers || {}) };
    if (cookie && target.hostname === new URL(BASE).hostname) headers.cookie = cookie;
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      await pause();
      try {
        response = await fetch(target, { method, body, headers, signal: AbortSignal.timeout(60000), redirect: 'manual' });
      } catch (error) {
        if (attempt >= 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * (2 ** attempt)));
        continue;
      }
      if (response.status >= 500 && attempt < 2) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await new Promise(resolve => setTimeout(resolve, Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30000) : 1000 * (2 ** attempt)));
        continue;
      }
      break;
    }
    if (typeof response.headers.getSetCookie === 'function') {
      const setCookie = response.headers.getSetCookie().map(x => x.split(';', 1)[0]).filter(Boolean);
      if (setCookie.length) cookie = setCookie.join('; ');
    }
    if (response.status === 403 || response.status === 429) throw new Error(`POLICY_STOP_HTTP_${response.status}:${target.hostname}${target.pathname}`);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) throw new Error(`REDIRECT_WITHOUT_LOCATION:${target.href}`);
    target = new URL(location, target);
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) { method = 'GET'; body = undefined; }
  }
  throw new Error('REDIRECT_LIMIT_EXCEEDED');
}
async function textRequest(url, options = {}) {
  const response = await request(url, options);
  const bytes = Buffer.from(await response.arrayBuffer());
  const headerCharset = response.headers.get('content-type')?.match(/charset\s*=\s*([^;\s]+)/i)?.[1];
  const metaCharset = bytes.toString('ascii').match(/<meta\b[^>]*charset\s*=\s*["']?([^"'\s/>;]+)/i)?.[1];
  const charset = headerCharset || metaCharset || 'utf-8';
  const text = new TextDecoder(charset).decode(bytes);
  if (/captcha|cap-widget|recaptcha|acceso restringido|inicie sesi[oó]n/i.test(text)) throw new Error('HUMAN_CHALLENGE_OR_LOGIN_REQUIRED');
  return { response, text };
}
function fieldsFromForm(html) {
  const fields = new URLSearchParams();
  for (const match of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const name = match[1].match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!name) continue;
    const options = [...match[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)];
    const selected = options.find(x => /\bselected\b/i.test(x[1])) || options[0];
    const value = selected?.[1].match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1];
    if (value !== undefined) fields.set(name, htmlDecode(value));
  }
  for (const match of html.matchAll(/<input\b([^>]*)>/gi)) {
    const attrs = match[1];
    const name = attrs.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1];
    const type = attrs.match(/\btype\s*=\s*["']?([^\s"']+)/i)?.[1]?.toLowerCase() || 'text';
    if (!name || ['button','reset','image','file'].includes(type)) continue;
    if (['checkbox','radio'].includes(type) && !/\bchecked\b/i.test(attrs)) continue;
    const value = attrs.match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
    fields.set(name, htmlDecode(value));
  }
  for (const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    const name = match[1].match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1];
    const value = match[1].match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1];
    if (name && value) fields.set(name, htmlDecode(value));
  }
  const sala = [...html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)].find(x => /\bname\s*=\s*["']sala["']/i.test(x[1]));
  const rooms = sala ? [...sala[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map(x => ({ value: x[1].match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1], label: stripHtml(x[2]) })).filter(x => x.value && x.value !== 'sd' && /^[A-M]$/i.test(x.value)) : [];
  return { fields, rooms };
}
function parseSearchResults(html, resultUrl) {
  const results = [];
  const seen = new Set();
  const pattern = /<a\b([^>]*)>/gi;
  for (const m of html.matchAll(pattern)) {
    const hrefMatch = m[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!hrefMatch) continue;
    const href = htmlDecode(hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3]);
    if (!/detalle[^/?]*\.php/i.test(href)) continue;
    const url = sameSiteUrl(href, resultUrl);
    if (!url.search) continue;
    const key = `${url.pathname}?${url.searchParams.toString()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ key, url: url.href });
  }
  const countText = stripHtml(html).match(/(?:Se encontraron|Se encontr[oó])\s+([\d.,]+)\s+(?:casos|caso)/i)?.[1] || null;
  const count = countText ? Number(countText.replace(/[.,]/g, '')) : /no se encontraron casos/i.test(stripHtml(html)) ? 0 : null;
  const hasPagination = /(?:p[aá]gina\s+\d|siguiente|next\s*page|offset\s*=|limit\s*=)/i.test(stripHtml(html))
    || [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi)].some(m => /(?:pagina|page|offset|inicio|siguiente|anterior)=/i.test(m[1]));
  return { results, count, hasPagination };
}
function parseDetail(html, detailUrl) {
  const text = stripHtml(html);
  const get = regex => text.match(regex)?.[1]?.trim() || null;
  const caseRecordId = get(/Caso\s+nro\.:\s*([\d.]+)/i);
  const title = get(/Car[aá]tula:\s*([\s\S]*?)(?:\s+Car[aá]cter:|\s+Juzgado:)/i);
  const expedientes = [...text.matchAll(/N[º°o.]?\s*Expte\.:\s*([^\s]+(?:\s*\/\s*\d{4})?)/gi)].map(m => m[1].trim());
  const exp = expedientes.find(value => /\/\s*\d{4}$/.test(value)) || expedientes[0] || null;
  const dates = [...text.matchAll(/Fecha\s+sentencia:\s*(\d{2}\/\d{2}\/\d{4})/gi)].map(x => x[1]);
  const toIso = value => {
    if (!value) return null;
    const [, d, m, y] = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/) || [];
    if (!y || Number(y) < 1900 || Number(y) > new Date().getUTCFullYear() + 1) return null;
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) return null;
    return `${y}-${m}-${d}`;
  };
  const parsedDates = dates.map(toIso);
  const dateWarnings = dates.flatMap((raw, index) => parsedDates[index] ? [] : [{ raw, position: index, reason: 'INVALID_OR_OUT_OF_RANGE' }]);
  const chamber = get(/Sala:\s*([A-M])/i);
  const firstInstanceCourt = get(/Juzgado:\s*([\w\s.-]+?)\s+N[º°o.]?\s*Expte\./i);
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(table => [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row => [...row[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(cell => stripHtml(cell[1]))).filter(row => row.length));
  const labels = {};
  for (const m of text.matchAll(/(?:^|\s)(Edad|Estado civil|Ocupaci[oó]n|Sexo|Salud|Capacitaci[oó]n|Fecha del hecho|Cant\. de reclamantes|Monto total|Monto otorgado en Cámara a la fecha|OBSERVACION)\s*:\s*([\s\S]*?)(?=\s+(?:Edad|Estado civil|Ocupaci[oó]n|Sexo|Salud|Capacitaci[oó]n|Fecha del hecho|Cant\. de reclamantes|Monto total|Monto otorgado en Cámara a la fecha|OBSERVACION)\s*:|$)/gi)) labels[m[1].toLocaleLowerCase('es-AR')] = m[2].trim();
  const metadata = { caseRecordId, title, expedientes, decisionDatesRaw: dates, decisionDates: parsedDates.filter(Boolean), dateParseWarnings: dateWarnings, chamber, firstInstanceCourt, labels, tables, sourceText: text };
  let viewerTarget = null;
  const sentenceLink = [...html.matchAll(/<a\b([^>]*?)>([\s\S]*?)<\/a>/gi)].find(x => /Ver\s+sentencia/i.test(stripHtml(x[2])));
  if (sentenceLink) viewerTarget = sentenceLink[1].match(/\btarget\s*=\s*["']([^"']+)["']/i)?.[1] || null;
  const directPdf = [...html.matchAll(/(?:href|src)\s*=\s*(["'])([^"']+\.pdf(?:\?[^"']*)?)\1/gi)].map(x => x[2])[0] || null;
  const hasOpinionText = /\b(?:VISTOS?|CONSIDERANDO|Y\s+VISTOS?|POR\s+ELLO)\b/i.test(text) && text.length > 2000;
  const detailKey = new URL(detailUrl).searchParams.get('numcas') || new URL(detailUrl).searchParams.get('idcas') || caseRecordId;
  return { caseRecordId, caseNumber: exp?.replace(/\s+/g, '') || null, title, chamber,
    firstInstanceCourt: firstInstanceCourt ? `Juzgado Nacional en lo Civil ${firstInstanceCourt}` : null,
    decisionDate: parsedDates.at(-1) || null, lowerDecisionDate: parsedDates[0] || null, viewerTarget, directPdf,
    detailKey, metadata, fullText: hasOpinionText ? text : null, sourceText: text };
}
function parseViewerUrl(html, pageUrl) {
  const call = html.match(/doOpen\s*\(\s*(['"])(.*?)\1\s*\)/is);
  if (call) return call[2].trim() ? new URL(call[2].replace(/\\'/g, "'").replace(/\\"/g, '"'), pageUrl).href : null;
  const uncommented = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const embed = uncommented.match(/<embed\b[^>]*\bsrc\s*=\s*(['"])(.*?)\1/i);
  if (embed) return sameSiteUrl(embed[2], pageUrl).href;
  return null;
}
function findPdfLink(html, pageUrl) {
  const uncommented = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const target = uncommented.match(/<iframe\b[^>]*\bsrc\s*=\s*(['"])(.*?)\1/i)?.[2];
  return target ? sameSiteUrl(target, pageUrl).href : null;
}
function commandGuard(args, { quiet = false } = {}) {
  const result = spawnSync(process.execPath, [path.join(BACK, 'scripts', 'with-dev-db-guard.cjs'), ...args], {
    cwd: BACK, encoding: 'utf8', env: process.env, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.stdout && !quiet) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`DEV_GUARD_FAILED:${args.join(' ')}:${result.status}`);
  return result.stdout || '';
}
async function importBatch(records, batchNumber) {
  const batchKey = records.map(row => row.source_key).sort().join('\n');
  const packageId = `civil-quantification-${sha256(Buffer.from(batchKey)).slice(0, 16)}`;
  const packageRoot = path.join(WORK, 'packages', packageId);
  const filesDir = path.join(packageRoot, 'files');
  fs.mkdirSync(filesDir, { recursive: true });
  const docs = [];
  for (const row of records) {
    const textDocument = row.pdf_status === 'TEXT_AVAILABLE' && Boolean(row.document_text);
    if (!row.sha256 && !textDocument) continue;
    const content = textDocument ? Buffer.from(row.document_text, 'utf8') : null;
    const contentHash = row.sha256 || sha256(content);
    const externalId = `${SOURCE_CODE}:${row.category === 'LESIONES_POST_2015' ? 'lesiones_po' : row.category.toLowerCase()}:${row.case_record_id || row.source_key.slice(-32)}`;
    const filename = `${contentHash}-${sha256(Buffer.from(externalId)).slice(0, 10)}.${textDocument ? 'txt' : 'pdf'}`;
    if (textDocument) fs.writeFileSync(path.join(filesDir, filename), content);
    else fs.copyFileSync(row.file_path, path.join(filesDir, filename));
    const categoryId = row.category === 'LESIONES_POST_2015' ? 'lesiones_po' : row.category.toLowerCase();
    docs.push({ path: filename, filename,
      externalId,
      sourceReference: [row.case_number, row.title, row.category].filter(Boolean).join(' — '),
      sourceUrl: row.detail_url, decisionDate: row.decision_date || undefined,
      caseNumber: row.case_number || undefined, title: row.title || undefined,
      court: 'Cámara Nacional de Apelaciones en lo Civil', chamber: row.chamber ? `Sala ${row.chamber}` : undefined,
      instance: 'SECOND_INSTANCE',
      documentType: 'JURISPRUDENCIA', mimeType: textDocument ? 'text/plain' : 'application/pdf', sha256: contentHash,
      visibility: 'INTERNAL', metadata: { sourceCode: SOURCE_CODE, category: row.category, caseRecordId: row.case_record_id, lowerDecisionDate: row.lower_decision_date },
      metadataOriginal: { source: SOURCE_CODE, category: row.category, detailUrl: row.detail_url, caseRecordId: row.case_record_id,
        caseNumber: row.case_number, title: row.title, decisionDate: row.decision_date, lowerDecisionDate: row.lower_decision_date,
        officialViewerUrl: row.pdf_url, httpStatus: row.http_status, mimeType: row.mime_type, sha256: row.sha256, bytes: row.byte_size } });
  }
  const manifest = { schemaVersion: '1.0', packageId, generatedAt: new Date().toISOString(),
    source: { code: SOURCE_CODE, name: 'PJN — Cámara Nacional de Apelaciones en lo Civil, Base de cuantificación de daños', type: 'OFFICIAL_PUBLIC_JURISPRUDENCE', baseUrl: BASE }, documents: docs };
  fs.writeFileSync(path.join(packageRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const dryRun = commandGuard(['corpus-package', 'dry-run', packageRoot], { quiet: true });
  const dryJsonStart = dryRun.indexOf('{');
  const drySummary = dryJsonStart >= 0 ? JSON.parse(dryRun.slice(dryJsonStart)) : null;
  let imported = false;
  let importReceipt = null;
  let importSummary = null;
  if (doImport) {
    // CorpusIngestionService records a new source provenance against the
    // existing CorpusDocumentFile when the SHA already exists, avoiding a
    // duplicate document while retaining the quantification source link.
    importReceipt = commandGuard(['corpus-package', 'import', packageRoot], { quiet: true });
    const receiptStart = importReceipt.lastIndexOf('\n{');
    const receipt = receiptStart >= 0 ? JSON.parse(importReceipt.slice(receiptStart + 1)) : null;
    if (!receipt || !['SUCCESS', 'ALREADY_IMPORTED', 'PARTIAL_SUCCESS'].includes(receipt.status)) throw new Error(`CORPUS_IMPORT_NOT_COMPLETE:${packageId}`);
    const successfulExternalIds = new Set(receipt.entries.filter(entry => !/FAILED|ERROR/.test(entry.status)).map(entry => entry.externalId));
    const failedByExternalId = new Map(receipt.entries.filter(entry => /FAILED|ERROR/.test(entry.status)).map(entry => [entry.externalId, entry.error || 'Corpus import needs review']));
    const mark = db.prepare("UPDATE records SET corpus_status='IMPORTED' WHERE source_key=?");
    const review = db.prepare("UPDATE records SET corpus_status=? WHERE source_key=?");
    for (const row of records) {
      const categoryId = row.category === 'LESIONES_POST_2015' ? 'lesiones_po' : row.category.toLowerCase();
      const externalId = `${SOURCE_CODE}:${categoryId}:${row.case_record_id || row.source_key.slice(-32)}`;
      if (successfulExternalIds.has(externalId)) mark.run(row.source_key);
      else if (failedByExternalId.has(externalId)) {
        const error = failedByExternalId.get(externalId);
        review.run(/CORPUS_HASH_AMBIGUOUS/.test(error) ? 'REVIEW_REQUIRED' : 'RETRYABLE', row.source_key);
      }
    }
    importSummary = { status: receipt.status, documentsTotal: receipt.documentsTotal, imported: receipt.imported,
      skipped: receipt.skipped, failed: receipt.failed, duplicateHashes: receipt.duplicateHashes };
    commandGuard(['sprint122-search-projection-verify']);
    imported = true;
  }
  const drySummaryCompact = drySummary ? { status: drySummary.status, validFiles: drySummary.validFiles, new: drySummary.new,
    alreadyKnown: drySummary.alreadyKnown, hashesAlreadyInCorpus: drySummary.hashesAlreadyInCorpus, bytes: drySummary.bytes } : null;
  return { packageId, packageRoot, dryRun: drySummaryCompact, importReceipt: importSummary, imported, docs: docs.length };
}

async function discover() {
  await textRequest(BASE);
  const now = new Date().toISOString();
  let visited = 0, saved = 0, failed = 0, bound = false;
  for (const [category, menu, formName, resultName] of FORMS) {
    const menuUrl = new URL(menu, BASE).href;
    const menuPage = await textRequest(menuUrl);
    const menuHasLink = [...menuPage.text.matchAll(/<a\b[^>]*\bhref\s*=\s*(['"])(.*?)\1/gi)].some(m => decodeURIComponent(htmlDecode(m[2])).includes(formName));
    if (!menuHasLink) { console.log(JSON.stringify({ event: 'form_not_linked_from_category', category, formName })); }
    const formUrl = new URL(formName, BASE).href;
    const formPage = await textRequest(formUrl);
    const formTag = formPage.text.match(/<form\b([^>]*)>/i)?.[1];
    if (!formTag || !/method\s*=\s*["']?post/i.test(formTag)) { failed++; console.log(JSON.stringify({ event: 'form_unavailable', category, formName })); continue; }
    const actionRaw = formTag.match(/\baction\s*=\s*(["'])(.*?)\1/i)?.[2];
    const resultUrl = sameSiteUrl(actionRaw || resultName, formUrl);
    if (path.basename(resultUrl.pathname) !== resultName) { failed++; console.log(JSON.stringify({ event: 'result_action_mismatch', category, expected: resultName, actual: resultUrl.href })); continue; }
    const { fields, rooms } = fieldsFromForm(formPage.text);
    const selectedRooms = rooms.length ? rooms : [{ value: null, label: 'ALL_VISIBLE_FILTERS' }];
    for (const room of selectedRooms) {
      if (maxQueries && visited >= maxQueries) { bound = true; break; }
      const roomKey = room.value || 'ALL';
      const queryKey = `${category}|${roomKey}`;
      const existing = qGet.get(queryKey);
      if (existing?.status === 'COMPLETE' && !args.has('refresh')) continue;
      const post = new URLSearchParams(fields);
      if (room.value) post.set('sala', room.value);
      const submitName = formPage.text.match(/<input\b([^>]*)type\s*=\s*["']?submit[^>]*>/i)?.[1]?.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1] || 'Submit';
      const submitValue = formPage.text.match(/<input\b([^>]*)type\s*=\s*["']?submit[^>]*>/i)?.[1]?.match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1] || 'Buscar';
      post.set(submitName, submitValue);
      visited++;
      try {
        const result = await textRequest(resultUrl.href, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', referer: formUrl }, body: post });
        if (result.response.status !== 200) throw new Error(`HTTP_${result.response.status}`);
        const parsed = parseSearchResults(result.text, resultUrl.href);
        const status = parsed.hasPagination ? 'PARTIAL_PAGINATION_REVIEW'
          : parsed.count === null && parsed.results.length === 0 ? 'UNPARSEABLE_EMPTY_RESPONSE'
            : parsed.count > 0 && parsed.results.length === 0 ? 'UNPARSED_DETAIL_LINKS'
              : parsed.count === 0 ? 'COMPLETE_ZERO' : 'COMPLETE';
        if (parsed.hasPagination) bound = true;
        const at = new Date().toISOString();
        qPut.run(queryKey, category, formUrl, resultUrl.href, room.value, status, result.response.status, parsed.count ?? parsed.results.length, parsed.results.length, at, null);
        for (const item of parsed.results) {
          const srcKey = `${category}:${item.key}`;
          rPut.run(srcKey, category, queryKey, item.url, null, at, at);
          saved++;
        }
        console.log(JSON.stringify({ event: 'quantification_search_complete', category, sala: room.value,
          declaredCount: parsed.count, detailLinks: parsed.results.length, paginationObserved: parsed.hasPagination,
          httpStatus: result.response.status, status }));
      } catch (error) {
        failed++;
        const at = new Date().toISOString();
        qPut.run(queryKey, category, formUrl, resultUrl.href, room.value, 'FAILED', null, null, null, at, String(error.message || error));
        console.error(JSON.stringify({ event: 'quantification_search_failed', category, sala: room.value, error: String(error.message || error) }));
        if (/POLICY_STOP|HUMAN_CHALLENGE|BLOCKED_HOST/.test(String(error.message))) { bound = true; break; }
      }
    }
    if (bound && maxQueries && visited >= maxQueries) break;
    if (bound && failed) break;
  }
  const querySummary = db.prepare('SELECT status,count(*) searches,coalesce(sum(result_count),0) results,coalesce(sum(detail_links),0) detailLinks FROM searches GROUP BY status').all();
  const recordSummary = db.prepare('SELECT count(*) sourceRows,count(DISTINCT category) categories,count(DISTINCT case_number) caseNumbers,count(DISTINCT sha256) pdfHashes FROM records').get();
  const totals = db.prepare('SELECT category,count(*) records FROM records GROUP BY category ORDER BY category').all();
  db.prepare("INSERT INTO meta(key,value) VALUES('last_discovery_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(now);
  console.log(JSON.stringify({ event: 'quantification_discovery_finished', sourceUrl: BASE, checkpoint: DB_PATH,
    newQueriesVisited: visited, recordRowsTouched: saved, failedQueries: failed, pendingDueToLimits: bound,
    queries: querySummary, records: recordSummary, categoryRecords: totals,
    paginationStatus: querySummary.some(x => x.status === 'PARTIAL_PAGINATION_REVIEW') ? 'REVIEW_REQUIRED' : 'NO_VISIBLE_PAGINATION_IN_COMPLETED_QUERIES' }, null, 2));
}

async function hydrateRecord(record) {
  if (record.pdf_status === 'VERIFIED' && record.file_path && fs.existsSync(record.file_path))
    return { status: 'ALREADY_VERIFIED', record };
  const detail = await textRequest(record.detail_url);
  if (detail.response.status !== 200) throw new Error(`DETAIL_HTTP_${detail.response.status}`);
  const parsed = parseDetail(detail.text, record.detail_url);
  const metadataJson = JSON.stringify(parsed.metadata);
  if (parsed.directPdf) return downloadPdf(record, parsed, sameSiteUrl(parsed.directPdf, record.detail_url).href, detail.response.status, 'PDF_DIRECT');
  if (!parsed.caseRecordId) {
    const state = parsed.sourceText.length < 300 ? 'EMPTY' : 'UNKNOWN';
    rPatch.run(parsed.caseRecordId, parsed.caseNumber, parsed.title, parsed.decisionDate, parsed.lowerDecisionDate, parsed.chamber,
      parsed.firstInstanceCourt, null, state, state, detail.response.status, null, null, null, null, 'No visible case identifier', metadataJson, parsed.fullText, record.source_key);
    return { status: state };
  }
  if (parsed.fullText) {
    rPatch.run(parsed.caseRecordId, parsed.caseNumber, parsed.title, parsed.decisionDate, parsed.lowerDecisionDate, parsed.chamber,
      parsed.firstInstanceCourt, null, 'TEXT_AVAILABLE', 'TEXT_AVAILABLE', detail.response.status, 'text/html', Buffer.byteLength(parsed.fullText), null, null, null, metadataJson, parsed.fullText, record.source_key);
    return { status: 'TEXT_AVAILABLE' };
  }
  if (!parsed.viewerTarget) {
    rPatch.run(parsed.caseRecordId, parsed.caseNumber, parsed.title, parsed.decisionDate, parsed.lowerDecisionDate, parsed.chamber,
      parsed.firstInstanceCourt, null, 'METADATA_ONLY', 'METADATA_ONLY', detail.response.status, null, null, null, null,
      'Metadata pública disponible; sin enlace ordinario de sentencia en la ficha', metadataJson, null, record.source_key);
    return { status: 'METADATA_ONLY' };
  }
  if (skipViewer) {
    rPatch.run(parsed.caseRecordId, parsed.caseNumber, parsed.title, parsed.decisionDate, parsed.lowerDecisionDate, parsed.chamber,
      parsed.firstInstanceCourt, null, 'REQUIRES_HUMAN', 'REQUIRES_HUMAN', detail.response.status, null, null, null, null,
      'Enlace de sentencia visible; consulta del visor pausada tras desafío CAPTCHA/login en el host oficial del visor', metadataJson, null, record.source_key);
    return { status: 'REQUIRES_HUMAN' };
  }
  const targetPath = parsed.viewerTarget.split('?')[0];
  if (path.basename(targetPath) !== 'contenedor_sen.php') throw new Error(`UNEXPECTED_SENTENCE_LINK:${parsed.viewerTarget}`);
  const viewerShellUrl = sameSiteUrl(parsed.viewerTarget, record.detail_url);
  const shell = await textRequest(viewerShellUrl.href);
  const frameUrl = findPdfLink(shell.text, viewerShellUrl.href);
  if (!frameUrl || path.basename(new URL(frameUrl).pathname) !== 'form_sen.php') throw new Error('VISIBLE_SENTENCE_VIEWER_FRAME_MISSING');
  const viewerFrame = await textRequest(frameUrl);
  const pdfUrl = parseViewerUrl(viewerFrame.text, frameUrl);
  if (!pdfUrl) {
    rPatch.run(parsed.caseRecordId, parsed.caseNumber, parsed.title, parsed.decisionDate, parsed.lowerDecisionDate, parsed.chamber,
      parsed.firstInstanceCourt, null, 'METADATA_ONLY', 'METADATA_ONLY', detail.response.status, null, null, null, null,
      'El visor visible no declara un documento recuperable en esta respuesta', metadataJson, null, record.source_key);
    return { status: 'METADATA_ONLY' };
  }
  if (new URL(pdfUrl).hostname !== ALLOWED_VIEWER_HOST) throw new Error('OFFICIAL_VIEWER_URL_HOST_NOT_ALLOWED');
  return downloadPdf(record, parsed, pdfUrl, detail.response.status, 'DOCUMENT_DYNAMIC');
}

async function downloadPdf(record, parsed, pdfUrl, detailStatus, sourceKind) {
  rPatch.run(parsed.caseRecordId, parsed.caseNumber, parsed.title, parsed.decisionDate, parsed.lowerDecisionDate, parsed.chamber,
    parsed.firstInstanceCourt, pdfUrl, sourceKind, null, detailStatus, null, null, null, null, null,
    JSON.stringify(parsed.metadata), parsed.fullText, record.source_key);
  const existing = rGet.get(record.source_key);
  if (existing.pdf_status === 'VERIFIED' && existing.file_path && fs.existsSync(existing.file_path)) return { status: 'ALREADY_VERIFIED', record: rGet.get(record.source_key) };
  const pdf = await request(pdfUrl, {}, true);
  const mimeType = pdf.headers.get('content-type') || '';
  const bytes = Buffer.from(await pdf.arrayBuffer());
  if (!isVerifiedPdf(pdf.status, mimeType, bytes)) {
    const preview = bytes.subarray(0, 12000).toString('utf8');
    const human = /captcha|cap-widget|recaptcha|acceso restringido|inicie sesi[oó]n/i.test(preview);
    rPatch.run(null, null, null, null, null, null, null, null, human ? 'REQUIRES_HUMAN' : 'BROKEN', 'FAILED', pdf.status, mimeType, bytes.length, null, null,
      `status=${pdf.status}; content-type=${mimeType}; signature=${bytes.subarray(0,5).toString('ascii')}`, null, null, record.source_key);
    if (human) throw new Error('HUMAN_CHALLENGE_OR_LOGIN_REQUIRED');
    return { status: 'PDF_FAILED' };
  }
  const checksum = sha256(bytes);
  const objects = path.join(WORK, 'objects');
  fs.mkdirSync(objects, { recursive: true });
  const filePath = path.join(objects, `${checksum}.pdf`);
  if (!fs.existsSync(filePath)) {
    const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, bytes, { flag: 'wx' });
    try { fs.renameSync(temporary, filePath); }
    catch (error) {
      if (!fs.existsSync(filePath)) throw error;
      fs.rmSync(temporary, { force: true });
    }
  }
  rPatch.run(null, null, null, null, null, null, null, null, sourceKind, 'VERIFIED', pdf.status, mimeType, bytes.length, checksum, filePath, null, null, null, record.source_key);
  return { status: 'VERIFIED', record: rGet.get(record.source_key) };
}

async function download() {
  const allTodo = db.prepare("SELECT * FROM records WHERE pdf_status IN ('NOT_ATTEMPTED','FAILED') OR (pdf_status IN ('VERIFIED','TEXT_AVAILABLE') AND corpus_status IN ('NOT_IMPORTED','RETRYABLE')) OR (?=1 AND pdf_status='METADATA_ONLY') OR (?=1 AND pdf_status='REQUIRES_HUMAN') ORDER BY category,source_key").all(retryMetadata ? 1 : 0, retryHuman ? 1 : 0);
  const todo = allTodo.filter(row => (!categoryFilter || row.category === categoryFilter)
    && (!sourceKeyFilter || row.source_key === sourceKeyFilter));
  const rows = maxRecords ? todo.slice(0, maxRecords) : todo;
  let verified = 0, textAvailable = 0, metadataOnly = 0, requiresHuman = 0, empty = 0, unknown = 0, failed = 0, importedDocs = 0, processed = 0, cursor = 0, stopWork = false, batch = [];
  const imported = [];
  let importChain = Promise.resolve();
  const queueImport = (force = false) => {
    if (batch.length < batchSize && !force) return importChain;
    const items = batch.splice(0, force ? batch.length : batchSize);
    importChain = importChain.then(async () => {
      const pkg = await importBatch(items, imported.length + 1);
      imported.push(pkg); importedDocs += pkg.docs;
    });
    return importChain;
  };
  // Seed the normal public session before concurrent detail requests.
  if (concurrency > 1) await textRequest(BASE);
  const worker = async () => {
    while (!stopWork) {
      const index = cursor++;
      if (index >= rows.length) return;
      const record = rows[index];
      let state = 'FAILED';
      try {
        const result = await hydrateRecord(record);
        state = result.status;
        if (state === 'VERIFIED' || state === 'ALREADY_VERIFIED') { verified++; batch.push(result.record); }
        else if (state === 'TEXT_AVAILABLE') { textAvailable++; batch.push(rGet.get(record.source_key)); }
        else if (state === 'REQUIRES_HUMAN') requiresHuman++;
        else if (state === 'EMPTY') empty++;
        else if (state === 'UNKNOWN') unknown++;
        else metadataOnly++;
      } catch (error) {
        failed++;
        const message = String(error.message || error);
        const needsHuman = /HUMAN_CHALLENGE|LOGIN_REQUIRED/.test(message);
        rPatch.run(null,null,null,null,null,null,null,null,needsHuman ? 'REQUIRES_HUMAN' : 'BROKEN','FAILED',null,null,null,null,null,message,null,null,record.source_key);
        console.error(JSON.stringify({ event: 'quantification_record_failed', sourceKey: record.source_key, detailUrl: record.detail_url, error: message }));
        if (/POLICY_STOP|HUMAN_CHALLENGE|BLOCKED_HOST/.test(message)) stopWork = true;
      }
      processed++;
      await queueImport(false);
      if (processed % 100 === 0 || processed === rows.length || state === 'FAILED') {
        console.log(JSON.stringify({ event: 'quantification_record_progress', processed, total: rows.length, sourceKey: record.source_key,
          status: rGet.get(record.source_key).pdf_status, verified, metadataOnly, requiresHuman, empty, unknown, failed, remaining: rows.length - processed, concurrency }));
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  await queueImport(true);
  await importChain;
  const packageSummaries = imported.map(({ packageId, dryRun: dry, importReceipt, imported: wasImported, docs }) => ({ packageId, dryRun: dry, importReceipt, imported: wasImported, docs }));
  console.log(JSON.stringify({ event: 'quantification_download_finished', candidates: rows.length, processed, verified, textAvailable, metadataOnly, requiresHuman, empty, unknown, failed, concurrency, skipViewer,
    importRequested: doImport, packageCount: imported.length, packageDocuments: importedDocs, packages: packageSummaries,
    checkpoint: DB_PATH, pendingRecords: db.prepare("SELECT count(*) n FROM records WHERE pdf_status IN ('NOT_ATTEMPTED','FAILED')").get().n }, null, 2));
}

function report() {
  console.log(JSON.stringify({ checkpoint: DB_PATH,
    source: { url: BASE, officialClaim: 'precedentes judiciales desde 1993 hasta la actualidad; cinco bases temáticas' },
    queries: db.prepare('SELECT status,count(*) searches,coalesce(sum(result_count),0) declaredResults,coalesce(sum(detail_links),0) detailLinks FROM searches GROUP BY status ORDER BY status').all(),
    detailInspection: db.prepare(`SELECT coalesce(sum(CASE WHEN pdf_status<>'NOT_ATTEMPTED' OR case_record_id IS NOT NULL THEN 1 ELSE 0 END),0) inspectedRows,
      coalesce(sum(CASE WHEN pdf_status='NOT_ATTEMPTED' AND case_record_id IS NULL THEN 1 ELSE 0 END),0) pendingDetails,
      count(DISTINCT case_record_id) distinctRecordIds,
      count(DISTINCT case_number) distinctCaseNumbers,min(decision_date) sampledOldestDate,max(decision_date) sampledNewestDate,
      coalesce(sum(CASE WHEN pdf_status='VERIFIED' THEN 1 ELSE 0 END),0) verifiedPdfs,
      coalesce(sum(CASE WHEN pdf_status='METADATA_ONLY' THEN 1 ELSE 0 END),0) metadataOnly,
      coalesce(sum(CASE WHEN pdf_status='FAILED' THEN 1 ELSE 0 END),0) failed,
      coalesce(sum(CASE WHEN pdf_status='NOT_ATTEMPTED' THEN 1 ELSE 0 END),0) notAttempted
      FROM records`).get(),
    categories: db.prepare(`SELECT category,count(*) sourceRows,count(DISTINCT case_number) uniqueCaseNumbers,
      sum(CASE WHEN pdf_status='VERIFIED' THEN 1 ELSE 0 END) verifiedPdfs,
      sum(CASE WHEN pdf_status='METADATA_ONLY' THEN 1 ELSE 0 END) metadataOnly,
      sum(CASE WHEN pdf_status='FAILED' THEN 1 ELSE 0 END) failed
      FROM records GROUP BY category ORDER BY category`).all(),
    detailStates: db.prepare(`SELECT CASE WHEN detail_status='PDF_VERIFIED' THEN 'DOCUMENT_DYNAMIC' ELSE detail_status END status,count(*) records
      FROM records GROUP BY CASE WHEN detail_status='PDF_VERIFIED' THEN 'DOCUMENT_DYNAMIC' ELSE detail_status END ORDER BY status`).all(),
    pdfMetrics: db.prepare(`SELECT sum(CASE WHEN pdf_status='VERIFIED' THEN 1 ELSE 0 END) verifiedRows,
      count(DISTINCT CASE WHEN pdf_status='VERIFIED' THEN sha256 END) uniqueHashes,
      sum(CASE WHEN pdf_status='VERIFIED' THEN byte_size ELSE 0 END) bytes,
      sum(CASE WHEN pdf_status='VERIFIED' THEN 1 ELSE 0 END)-count(DISTINCT CASE WHEN pdf_status='VERIFIED' THEN sha256 END) duplicateRows
      FROM records`).get(),
    byYear: db.prepare(`SELECT coalesce(substr(decision_date,1,4),'UNKNOWN') year,
      count(*) sourceRows,
      count(DISTINCT coalesce(case_number,case_record_id)) knownCases,
      count(DISTINCT CASE WHEN pdf_status='VERIFIED' THEN sha256 END) verifiedPdfs,
      count(DISTINCT CASE WHEN pdf_status='METADATA_ONLY' THEN coalesce(case_number,case_record_id) END) metadataOnlyCases,
      count(DISTINCT CASE WHEN pdf_status='REQUIRES_HUMAN' THEN coalesce(case_number,case_record_id) END) requiresHumanCases,
      count(DISTINCT CASE WHEN pdf_status IN ('NOT_ATTEMPTED','FAILED') THEN coalesce(case_number,case_record_id) END) pendingOrFailedCases
      FROM records GROUP BY substr(decision_date,1,4) ORDER BY year`).all(),
    totals: db.prepare(`SELECT count(*) sourceRows,count(DISTINCT case_number) uniqueCaseNumbers,
      count(DISTINCT sha256) distinctHashes,sum(CASE WHEN pdf_status='VERIFIED' THEN 1 ELSE 0 END) verifiedPdfs,
      sum(CASE WHEN pdf_status='METADATA_ONLY' THEN 1 ELSE 0 END) metadataOnly,
      sum(CASE WHEN pdf_status='FAILED' THEN 1 ELSE 0 END) failed FROM records`).get()
  }, null, 2));
}

function selfTest() {
  const assert = require('node:assert/strict');
  const fixture = '<table><tr><td>Caso nro.: 42</td></tr><tr><td>Carátula: PÉREZ, ANA C/ ACME S.A.</td></tr><tr><td>Carácter: PEATÓN</td></tr><tr><td>Juzgado: 4 Nº Expte.: 12345 / 2020 Fecha sentencia: 01/02/2021</td></tr><tr><td>Sala: A Ver sentencia Fecha sentencia: 03/04/2022 Edad: 33 Ocupación: DOCENTE Monto total: $ 100.000</td></tr></table><a href="#" target="contenedor_sen.php?p=le_p&n=42">Ver sentencia</a>';
  const parsed = parseDetail(fixture, `${BASE}detalle.php?numcas=fixture`);
  assert.equal(parsed.caseRecordId, '42');
  assert.equal(parsed.title, 'PÉREZ, ANA C/ ACME S.A.');
  assert.equal(parsed.caseNumber, '12345/2020');
  assert.equal(parsed.decisionDate, '2022-04-03');
  assert.equal(parsed.chamber, 'A');
  assert.equal(parsed.viewerTarget, 'contenedor_sen.php?p=le_p&n=42');
  assert.equal(parsed.metadata.labels.edad, '33');
  const outlier = parseDetail('<div>Caso nro.: 7 Carátula: DAÑO MORAL C/ NIÑO</div><div>Juzgado: 1 Nº Expte.: 7/2021 Fecha sentencia: 25/03/2021</div><div>Sala: C Fecha sentencia: 31/03/3022</div>', `${BASE}detalle.php?numcas=outlier`);
  assert.equal(outlier.decisionDate, null);
  assert.equal(outlier.lowerDecisionDate, '2021-03-25');
  assert.deepEqual(outlier.metadata.dateParseWarnings, [{ raw: '31/03/3022', position: 1, reason: 'INVALID_OR_OUT_OF_RANGE' }]);
  assert.equal(htmlDecode('Da&ntilde;o &aacute; &Ntilde;'), 'Daño á Ñ');
  const viewer = `function doOpen(url){} doOpen('https://scw.pjn.gov.ar/scw/viewer.seam?id=sample&tipoDoc=sentencia')`;
  assert.equal(parseViewerUrl(viewer, `${BASE}form_sen.php?p=x`), 'https://scw.pjn.gov.ar/scw/viewer.seam?id=sample&tipoDoc=sentencia');
  assert.equal(findPdfLink('<!-- <iframe src="form_sen.php?old"> --><iframe src="form_sen.php?p=le_p&n=42">', `${BASE}contenedor_sen.php?p=x`), `${BASE}form_sen.php?p=le_p&n=42`);
  assert.equal(isVerifiedPdf(200, 'application/pdf', Buffer.from('%PDF-1.4')), true);
  assert.equal(isVerifiedPdf(200, 'text/html', Buffer.from('%PDF-1.4')), false);
  assert.equal(isVerifiedPdf(403, 'application/pdf', Buffer.from('%PDF-1.4')), false);
  console.log('quantification detail/viewer/PDF/date/entity: 15 assertions PASS');
}

(async () => {
  try {
    if (mode === 'report') report();
    else if (mode === 'discover') await discover();
    else if (mode === 'download') await download();
    else if (mode === 'self-test') selfTest();
    else throw new Error(`UNKNOWN_MODE:${mode}`);
  } catch (error) {
    console.error(JSON.stringify({ event: 'quantification_crawl_stopped', error: String(error.message || error), checkpoint: DB_PATH }));
    process.exitCode = 1;
  } finally { db.close(); }
})();

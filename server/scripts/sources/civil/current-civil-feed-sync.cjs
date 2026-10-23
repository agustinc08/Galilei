'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const BACK = path.join(ROOT, 'server');
const WORK = path.join(ROOT, '_recovery-work', 'sprint143');
const DB_PATH = path.join(WORK, 'current.sqlite');
const SOURCE_URL = 'https://www.csjn.gov.ar/tribunales-federales-nacionales/sentencias.html';
const ROBOTS_URL = 'https://www.csjn.gov.ar/robots.txt';
const UA = 'BuscadorJuridicoCivil-Research/1.0 (+local audit)';
const delayMs = Number(process.env.BJC_CIVIL_SYNC_DELAY_MS || 750);
const syncInterval = process.env.CIVIL_SYNC_INTERVAL || 'manual';

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&aacute;/gi, 'á').replace(/&eacute;/gi, 'é').replace(/&iacute;/gi, 'í')
    .replace(/&oacute;/gi, 'ó').replace(/&uacute;/gi, 'ú').replace(/&ntilde;/gi, 'ñ')
    .replace(/&Aacute;/g, 'Á').replace(/&Eacute;/g, 'É').replace(/&Iacute;/g, 'Í')
    .replace(/&Oacute;/g, 'Ó').replace(/&Uacute;/g, 'Ú').replace(/&Ntilde;/g, 'Ñ')
    .replace(/&ordm;/gi, 'º').replace(/&deg;/gi, '°').replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function plain(value) {
  return decodeEntities(String(value || '').replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).trim();
}
function normalizeCourt(value) {
  return plain(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    .replace(/[º°]/g, ' ').replace(/\bNRO\.?\b/g, ' ').replace(/\s+/g, ' ').trim();
}
function parseCivilCourt(original) {
  const court = normalizeCourt(original);
  if (/^(?:CAMARA NACIONAL DE APELACIONES EN LO CIVIL|CAMARA CIVIL)(?! Y COMERCIAL FEDERAL)(?:\s*[-,]\s*SALA\s+(?:[A-M]\b|FERIA\b)|\s+SALA\s+(?:[A-M]\b|FERIA\b))?(?:\s|$)/.test(court)) {
    const sala = court.match(/\bSALA\s+([A-M]|FERIA)\b/)?.[1] || null;
    return { type: 'CAMARA', normalized: 'Cámara Nacional de Apelaciones en lo Civil', instance: 'SECOND_INSTANCE', chamber: sala ? `Sala ${sala === 'FERIA' ? 'Feria' : sala}` : null };
  }
  const isJuzgado = /^JUZGADO\s+(?:(?:NACIONAL\s+(?:DE\s+)?(?:1RA|PRIMERA)\s+INSTANCIA\s+)?(?:EN\s+)?)?CIVIL\b/.test(court)
    || /^JUZGADO NACIONAL EN LO CIVIL\b/.test(court);
  if (!isJuzgado) return null;
  const number = court.match(/\bCIVIL\s+(?:N(?:RO|UMERO)?\s*)?(\d{1,3})\b/)?.[1]
    || court.match(/\bN(?:RO|UMERO)?\s*(\d{1,3})\b/)?.[1] || null;
  const secretaria = court.match(/\bSECRETARIA\s+(?:N(?:RO|UMERO)?\s*)?(\d{1,3})\b/)?.[1] || null;
  const chamber = number ? `Juzgado Civil ${Number(number)}${secretaria ? ` — Secretaría ${Number(secretaria)}` : ''}` : plain(original);
  return { type: 'JUZGADO', normalized: 'Juzgado Nacional en lo Civil', instance: 'FIRST_INSTANCE', chamber };
}
function parseDate(value) {
  const match = plain(value).match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}
function parseResultBlock(block, listedIndex, discoveredAt) {
  const fields = {};
  for (const match of block.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const item = match[1];
    const label = plain(item.match(/<(?:span|strong|b)\b[^>]*>([\s\S]*?)<\/(?:span|strong|b)>/i)?.[1] || '')
      .toLowerCase().replace(/[:\s]+$/g, '');
    const value = plain(item.replace(/<(?:span|strong|b)\b[^>]*>[\s\S]*?<\/(?:span|strong|b)>/i, ''));
    if (label.startsWith('tribunal')) fields.tribunal = value;
    else if (label.startsWith('expediente')) fields.caseNumber = value;
    else if (label.startsWith('car')) fields.title = value;
    else if (label.startsWith('fecha')) fields.dateText = value;
    else if (label.startsWith('sala')) fields.sala = value;
  }
  const links = [...block.matchAll(/<a\b([^>]*)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi)];
  const download = links.map(match => ({ href: decodeEntities(match[2]), label: plain(match[4]) }))
    .find(link => /^descargar$/i.test(link.label));
  if (!fields.tribunal || !download) return null;
  const pdfUrl = new URL(download.href, SOURCE_URL);
  if (pdfUrl.hostname !== 'www.csjn.gov.ar' || pdfUrl.protocol !== 'https:' || !pdfUrl.pathname.toLowerCase().endsWith('.pdf')) {
    throw new Error(`Link Descargar fuera del host público o no es PDF: ${pdfUrl.origin}${pdfUrl.pathname}`);
  }
  const filename = path.posix.basename(pdfUrl.pathname);
  const idMatch = filename.match(/sentencia-SGU-([0-9a-f]{8}-[0-9a-f-]{27,})\.pdf$/i);
  const externalId = idMatch ? idMatch[1].toLowerCase() : filename;
  const decisionDate = parseDate(fields.dateText || '');
  const court = parseCivilCourt(fields.tribunal);
  if (!court) return { externalId, listedIndex, tribunal: fields.tribunal, caseNumber: fields.caseNumber || null,
    title: fields.title || null, decisionDate, isCivil: false };
  return {
    externalId,
    listedIndex,
    tribunal: fields.tribunal,
    normalizedCourt: court.normalized,
    courtType: court.type,
    chamber: fields.sala ? plain(fields.sala) : court.chamber,
    instance: court.instance,
    caseNumber: fields.caseNumber || null,
    title: fields.title || null,
    dateText: fields.dateText || null,
    decisionDate,
    pdfUrl: pdfUrl.href,
    sourceUrl: SOURCE_URL,
    discoveredAt,
  };
}
function parsePublicFeed(html, discoveredAt = new Date().toISOString()) {
  const blocks = [...html.matchAll(/<div\s+class=["']result["'][^>]*>([\s\S]*?)<\/div>/gi)];
  const all = blocks.map((match, index) => parseResultBlock(match[1], index + 1, discoveredAt)).filter(Boolean);
  const civil = all.filter(entry => entry.isCivil !== false);
  const visiblePagination = /<(?:a|button)\b[^>]*(?:onclick=["'][^"']*irPaginaF\s*\(|class=["'][^"']*(?:page-link|pagination)[^"']*["'])/i.test(html);
  const dateInputs = Object.fromEntries([...html.matchAll(/<input\b(?=[^>]*\bname=["'](fecha_fallo_desde|fecha_fallo_hasta)["'])(?=[^>]*\bvalue=["']([^"']+)["'])[^>]*>/gi)].map(match => [match[1], match[2]]));
  const dateSequence = all.map(entry => entry.decisionDate).filter(Boolean);
  const sourceOrderNonIncreasingByDate = dateSequence.every((value, index) => index === 0 || dateSequence[index - 1] >= value);
  return {
    resultCount: blocks.length,
    all,
    civil,
    pageSizeObserved: blocks.length,
    visiblePagination,
    defaultDateWindow: dateInputs,
    sourceOrderNonIncreasingByDate,
    oldestVisibleDate: dateSequence.length ? [...dateSequence].sort()[0] : null,
    newestVisibleDate: dateSequence.length ? [...dateSequence].sort().at(-1) : null,
    hasCapWidget: /<cap-widget\b|recaptcha|g-recaptcha/i.test(html),
  };
}
function openDb() {
  fs.mkdirSync(WORK, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;
    CREATE TABLE IF NOT EXISTS runs (run_id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, http_status INTEGER, results_visible INTEGER NOT NULL DEFAULT 0, civil_visible INTEGER NOT NULL DEFAULT 0, latest_sentence_date TEXT, pagination TEXT, robots_pdf_disallow INTEGER NOT NULL DEFAULT 0, error TEXT);
    CREATE TABLE IF NOT EXISTS records (external_id TEXT PRIMARY KEY, tribunal TEXT NOT NULL, normalized_court TEXT NOT NULL, court_type TEXT NOT NULL, chamber TEXT, instance TEXT NOT NULL, case_number TEXT, title TEXT, decision_date TEXT, pdf_url TEXT NOT NULL, source_url TEXT NOT NULL, discovered_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, last_run_id TEXT NOT NULL, download_status TEXT NOT NULL, http_status INTEGER, sha256 TEXT, bytes INTEGER, file_path TEXT, corpus_status TEXT NOT NULL, error TEXT);
    CREATE INDEX IF NOT EXISTS idx_current_civil_date ON records(decision_date);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  const runColumns = new Set(db.prepare('PRAGMA table_info(runs)').all().map(row => row.name));
  for (const [name, definition] of Object.entries({ oldest_visible_date: 'TEXT', newest_visible_date: 'TEXT', feed_ids: "TEXT NOT NULL DEFAULT '[]'", possible_feed_gap: 'INTEGER NOT NULL DEFAULT 0' })) {
    if (!runColumns.has(name)) db.exec(`ALTER TABLE runs ADD COLUMN ${name} ${definition}`);
  }
  return db;
}
function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function checkRobots(robots, targetUrl) {
  const pathName = new URL(targetUrl).pathname;
  const disallow = robots.split(/\r?\n/).filter(line => /^Disallow:/i.test(line)).map(line => line.split(':').slice(1).join(':').trim()).filter(Boolean);
  return disallow.some(rule => rule !== '/' && pathName.startsWith(rule));
}
async function fetchText(url) {
  const response = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`GET ${new URL(url).pathname} HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const charset = response.headers.get('content-type')?.match(/charset=([^;\s]+)/i)?.[1] || 'utf-8';
  return { response, text: new TextDecoder(charset).decode(bytes) };
}
async function downloadPdf(record, redirects = 0) {
  if (redirects > 2) return { status: 'BLOCKED', error: 'Más de dos redirects; no se continuó' };
  const response = await fetch(record.pdfUrl, { headers: { 'user-agent': UA, referer: SOURCE_URL, accept: 'application/pdf,*/*' }, redirect: 'manual', signal: AbortSignal.timeout(60000) });
  if ([403, 429].includes(response.status)) return { status: 'BLOCKED', httpStatus: response.status, error: `HTTP ${response.status}; sin evasión` };
  if (response.status >= 500) return { status: 'FAILED', httpStatus: response.status, error: `HTTP ${response.status}` };
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) return { status: 'FAILED', httpStatus: response.status, error: 'Redirect sin Location' };
    const target = new URL(location, record.pdfUrl);
    if (target.hostname !== 'www.csjn.gov.ar' || target.protocol !== 'https:') return { status: 'BLOCKED', httpStatus: response.status, error: 'Redirect fuera del host oficial; no seguido' };
    await sleep(delayMs);
    return downloadPdf({ ...record, pdfUrl: target.href }, redirects + 1);
  }
  if (response.status !== 200) return { status: 'FAILED', httpStatus: response.status, error: `HTTP ${response.status}` };
  const contentType = response.headers.get('content-type') || '';
  if (!/^application\/pdf(?:\s*;|$)/i.test(contentType)) return { status: 'FAILED', httpStatus: 200, error: `MIME no PDF: ${contentType}` };
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') return { status: 'FAILED', httpStatus: 200, error: 'Archivo vacío o firma PDF inválida' };
  const hash = sha256(bytes);
  const localCorpusPath = path.join(ROOT, '_dev-corpus-storage', hash.slice(0, 2), `${hash}.pdf`);
  try {
    const localBytes = await fsp.readFile(localCorpusPath);
    if (sha256(localBytes) === hash) return { status: 'ALREADY_LOCAL', httpStatus: 200, contentType, sha256: hash, bytes: localBytes.length, filePath: localCorpusPath };
  } catch { /* this hash is not present in DEV storage */ }
  const filePath = path.join(WORK, 'objects', `${hash}.pdf`);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tempPath, bytes, { flag: 'wx' });
  try { await fsp.rename(tempPath, filePath); }
  catch (error) { await fsp.rm(tempPath, { force: true }); if (error.code !== 'EEXIST') throw error; }
  return { status: 'VERIFIED', httpStatus: 200, contentType, sha256: hash, bytes: bytes.length, filePath };
}
function runGuard(args, env = {}) {
  const result = spawnSync(process.execPath, [path.join(BACK, 'scripts', 'with-dev-db-guard.cjs'), ...args], {
    cwd: BACK, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`DEV guard action failed: ${args.join(' ')} (exit ${result.status})`);
  return result.stdout || '';
}
async function makePackage(record, download) {
  const packageId = `civil-current-${record.externalId.replace(/[^a-z0-9]/gi, '').slice(0, 28)}`;
  const packageRoot = path.join(WORK, 'packages', packageId);
  const files = path.join(packageRoot, 'files');
  await fsp.mkdir(files, { recursive: true });
  const filename = `${download.sha256}.pdf`;
  const dest = path.join(files, filename);
  try { await fsp.copyFile(download.filePath, dest, fs.constants.COPYFILE_EXCL); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const metadataOriginal = {
    source: 'TFN_ACTUAL_PUBLIC_FEED', acquisitionMode: download.acquisitionMode || 'PUBLIC_FEED', externalId: record.externalId,
    tribunal: record.tribunal, chamberOrJuzgado: record.chamber,
    caseNumber: record.caseNumber, title: record.title, dateText: record.dateText,
    pdfUrl: record.pdfUrl, sourceUrl: record.sourceUrl, discoveredAt: record.discoveredAt,
    downloadedAt: new Date().toISOString(), httpStatus: download.httpStatus,
    sha256: download.sha256, bytes: download.bytes,
  };
  const manifest = {
    schemaVersion: '1.0', packageId, generatedAt: record.discoveredAt,
    source: { code: 'TFN_ACTUAL_CIVIL', name: 'CSJN — listado público actual TFN (Civil)', type: 'OFFICIAL_PUBLIC_JURISPRUDENCE', baseUrl: SOURCE_URL },
    documents: [{
      path: filename, filename, externalId: `TFN_ACTUAL:${record.externalId}`,
      sourceReference: [record.caseNumber, record.tribunal].filter(Boolean).join(' — '),
      sourceUrl: record.sourceUrl, decisionDate: record.decisionDate || undefined,
      caseNumber: record.caseNumber || undefined, title: record.title || undefined,
      court: record.tribunal, chamber: record.chamber || undefined,
      instance: record.instance, documentType: 'JURISPRUDENCIA',
      mimeType: 'application/pdf', sha256: download.sha256, visibility: 'INTERNAL',
      metadata: { externalId: record.externalId, sourceCode: 'TFN_ACTUAL_CIVIL', tribunal: record.tribunal, chamberOrJuzgado: record.chamber, caseNumber: record.caseNumber, decisionDate: record.decisionDate },
      metadataOriginal,
    }],
  };
  await fsp.writeFile(path.join(packageRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8' });
  return { packageId, packageRoot };
}
function status() {
  const db = openDb();
  const current = db.prepare(`SELECT count(*) AS known,sum(CASE WHEN download_status IN ('VERIFIED','ALREADY_LOCAL') THEN 1 ELSE 0 END) AS downloaded,sum(CASE WHEN corpus_status='INDEXED' THEN 1 ELSE 0 END) AS "indexed",sum(CASE WHEN download_status NOT IN ('VERIFIED','ALREADY_LOCAL') OR corpus_status NOT IN ('INDEXED','OCR_REQUIRED') THEN 1 ELSE 0 END) AS pending,max(decision_date) AS latestSentence,max(last_seen_at) AS lastSeen FROM records`).get();
  const byInstance = db.prepare(`SELECT court_type,count(*) AS known,sum(CASE WHEN download_status IN ('VERIFIED','ALREADY_LOCAL') THEN 1 ELSE 0 END) AS downloaded,sum(CASE WHEN corpus_status='INDEXED' THEN 1 ELSE 0 END) AS "indexed",sum(CASE WHEN download_status NOT IN ('VERIFIED','ALREADY_LOCAL') OR corpus_status NOT IN ('INDEXED','OCR_REQUIRED') THEN 1 ELSE 0 END) AS pending,min(decision_date) AS firstDate,max(decision_date) AS lastDate FROM records GROUP BY court_type`).all();
  const meta = Object.fromEntries(db.prepare('SELECT key,value FROM meta').all().map(row => [row.key,row.value]));
  const run = db.prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT 1').get();
  const historicalPath = path.join(ROOT, '_recovery-work', 'sprint142', 'historical.sqlite');
  const historical = new DatabaseSync(historicalPath, { readOnly: true });
  const historicalCivil = historical.prepare("SELECT count(*) known FROM results WHERE civil_status='CIVIL_EXACT'").get();
  const historicalPages = historical.prepare("SELECT count(*) complete FROM pages WHERE status='COMPLETE'").get();
  const historicalPdfs = historical.prepare('SELECT status,count(*) n,coalesce(sum(bytes),0) bytes FROM downloads GROUP BY status').all();
  const merged = { chamber: byInstance.find(item => item.court_type === 'CAMARA') || { known: 0, downloaded: 0, indexed: 0, pending: 0 }, firstInstance: byInstance.find(item => item.court_type === 'JUZGADO') || { known: 0, downloaded: 0, indexed: 0, pending: 0 } };
  console.log(JSON.stringify({ status: 'CIVIL_ACQUISITION_STATUS', historical: { total: 226770, pages: `${historicalPages.complete}/11339`, civilKnown: historicalCivil.known, firstDate: '2008-07-07', lastDate: '2013-08-28', pdfs: historicalPdfs }, currentFeed: { latestRun: run || null, byInstance, mergedCounts: merged, lastSuccessfulRun: meta.last_successful_run || null, overlap: 'all visible Civil external IDs in the latest 20 source-listed results', paginationReliable: false, paginationReason: 'The initial page has no visible pagination; paged results require the filtered POST/token flow.' }, latestCurrentSentence: current.latestSentence || null, failureNote: 'Histórico flid=101 HTTP 404; no se borró del manifest.' }, null, 2));
  historical.close();
  db.close();
}
async function main() {
  if (process.argv.includes('--status')) return status();
  const db = openDb();
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const insRun = db.prepare("INSERT INTO runs(run_id,started_at,status) VALUES(?,?,'RUNNING')");
  insRun.run(runId, startedAt);
  try {
    const robotsResult = await fetch(ROBOTS_URL, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) });
    if (!robotsResult.ok) throw new Error(`robots.txt HTTP ${robotsResult.status}`);
    const robotsText = await robotsResult.text();
    const pdfDisallow = checkRobots(robotsText, 'https://www.csjn.gov.ar/tribunales-federales-nacionales/d/sample.pdf');
    const page = await fetchText(SOURCE_URL);
    const parsed = parsePublicFeed(page.text, startedAt);
    const allCivil = parsed.civil.filter(record => record.externalId);
    const dates = allCivil.map(record => record.decisionDate).filter(Boolean).sort();
    const pagination = parsed.visiblePagination ? 'VISIBLE_CONTROLS' : 'NO_VISIBLE_CONTROLS';
    const feedIds = parsed.all.map(record => record.externalId).filter(Boolean);
    const previous = db.prepare('SELECT results_visible,feed_ids FROM runs WHERE run_id<>? AND feed_ids IS NOT NULL ORDER BY started_at DESC LIMIT 1').get(runId);
    let possibleFeedGap = false;
    if (parsed.resultCount === 20 && feedIds.length === 20 && previous?.results_visible === 20) {
      try {
        const oldIds = JSON.parse(previous.feed_ids || '[]');
        if (oldIds.length === 20) possibleFeedGap = !feedIds.some(id => oldIds.includes(id));
      } catch { /* old checkpoint has no usable feed identity snapshot */ }
    }
    db.prepare('UPDATE runs SET http_status=?,results_visible=?,civil_visible=?,latest_sentence_date=?,pagination=?,robots_pdf_disallow=?,oldest_visible_date=?,newest_visible_date=?,feed_ids=?,possible_feed_gap=? WHERE run_id=?')
      .run(page.response.status, parsed.resultCount, allCivil.length, dates.at(-1) || null, pagination, pdfDisallow ? 1 : 0,
        parsed.oldestVisibleDate, parsed.newestVisibleDate, JSON.stringify(feedIds), possibleFeedGap ? 1 : 0, runId);
    const existing = db.prepare('SELECT external_id,download_status,sha256,corpus_status FROM records WHERE external_id=?');
    const upsert = db.prepare(`INSERT INTO records(external_id,tribunal,normalized_court,court_type,chamber,instance,case_number,title,decision_date,pdf_url,source_url,discovered_at,last_seen_at,last_run_id,download_status,corpus_status)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'DISCOVERED','NOT_IMPORTED')
      ON CONFLICT(external_id) DO UPDATE SET tribunal=excluded.tribunal,normalized_court=excluded.normalized_court,court_type=excluded.court_type,chamber=excluded.chamber,instance=excluded.instance,case_number=excluded.case_number,title=excluded.title,decision_date=excluded.decision_date,pdf_url=excluded.pdf_url,last_seen_at=excluded.last_seen_at,last_run_id=excluded.last_run_id`);
    let newRecords = 0, alreadyKnown = 0, downloaded = 0, imported = 0, blocked = 0, failures = 0;
    for (const item of allCivil) {
      const old = existing.get(item.externalId);
      if (old) alreadyKnown += 1; else newRecords += 1;
      upsert.run(item.externalId,item.tribunal,item.normalizedCourt,item.courtType,item.chamber,item.instance,item.caseNumber,item.title,item.decisionDate,item.pdfUrl,item.sourceUrl,item.discoveredAt,startedAt,runId);
      if (old && ['VERIFIED','ALREADY_LOCAL'].includes(old.download_status) && ['INDEXED','OCR_REQUIRED'].includes(old.corpus_status)) continue;
      await sleep(delayMs);
      const result = await downloadPdf(item);
      let resultCorpusStatus = null;
      db.prepare('UPDATE records SET download_status=?,http_status=?,sha256=?,bytes=?,file_path=?,error=? WHERE external_id=?')
        .run(result.status,result.httpStatus || null,result.sha256 || null,result.bytes || null,result.filePath || null,result.error || null,item.externalId);
      if (result.status === 'VERIFIED' || result.status === 'ALREADY_LOCAL') {
        downloaded += 1;
        const fullResult = { ...result };
        if (result.status === 'VERIFIED') {
          const localCorpusPath = path.join(ROOT, '_dev-corpus-storage', result.sha256.slice(0,2), `${result.sha256}.pdf`);
          try { await fsp.access(localCorpusPath); fullResult.filePath = localCorpusPath; }
          catch { /* package from the newly verified source object */ }
        }
        const pkg = await makePackage(item, fullResult);
        runGuard(['corpus-package','dry-run',pkg.packageRoot]);
        runGuard(['corpus-package','import',pkg.packageRoot]);
        const verification = runGuard(['civil-current-verify'], { BJC_CIVIL_CURRENT_EXTERNAL_ID: `TFN_ACTUAL:${item.externalId}`, BJC_CIVIL_CURRENT_CASE_NUMBER: item.caseNumber || '' });
        const verifyLine = verification.split(/\r?\n/).find(line => line.startsWith('CURRENT_CIVIL_VERIFY='));
        const verified = verifyLine ? JSON.parse(verifyLine.slice('CURRENT_CIVIL_VERIFY='.length)) : null;
        if (!verified) throw new Error('No se encontró el resumen de verificación Search/visor.');
        resultCorpusStatus = verified.outcome;
        db.prepare('UPDATE records SET corpus_status=? WHERE external_id=?').run(verified.outcome, item.externalId);
        imported += 1;
      } else if (result.status === 'BLOCKED') blocked += 1;
      else failures += 1;
      console.log(JSON.stringify({ event:'current_civil_result',externalId:item.externalId,court:item.tribunal,caseNumber:item.caseNumber,date:item.decisionDate,download:result.status,httpStatus:result.httpStatus||null,sha256:result.sha256||null,corpusStatus:resultCorpusStatus,error:result.error||null }));
    }
    const finishedAt = new Date().toISOString();
    const finalStatus = failures || blocked ? 'PARTIAL' : parsed.hasCapWidget || !parsed.visiblePagination ? 'PARTIAL_BOUNDED_FEED' : 'PASS';
    db.prepare('UPDATE runs SET finished_at=?,status=?,error=? WHERE run_id=?').run(finishedAt,finalStatus,failures || blocked ? `${failures} fallas; ${blocked} bloqueos` : null,runId);
    setMeta(db,'last_successful_run',finishedAt);
    setMeta(db,'last_run_id',runId);
    setMeta(db,'latest_sentence_date',dates.at(-1) || '');
    console.log(JSON.stringify({ event:'current_civil_sync_complete',runId,status:finalStatus,httpStatus:page.response.status,serverRenderedHtml:true,resultsVisible:parsed.resultCount,civilVisible:allCivil.length,newExternalIds:newRecords,alreadyKnown,downloaded,imported,blocked,failures,hasCapWidget:parsed.hasCapWidget,challengeInvoked:false,pdfRobotsDisallow:pdfDisallow,visiblePagination:parsed.visiblePagination,paginationReliable:false,paginationReason:'El listado inicial expone como máximo los resultados visibles; los controles de página pertenecen al POST filtrado con token.',dateWindow:parsed.defaultDateWindow,oldestVisibleDate:parsed.oldestVisibleDate,newestVisibleDate:parsed.newestVisibleDate,latestSentenceDate:dates.at(-1)||null,possibleFeedGap,warningCode:possibleFeedGap?'POSSIBLE_FEED_GAP':null,feedIdentityCount:feedIds.length,syncInterval,sourceOrderNonIncreasingByDate:parsed.sourceOrderNonIncreasingByDate },null,2));
  } catch (error) {
    db.prepare('UPDATE runs SET finished_at=?,status=\'FAILED\',error=? WHERE run_id=?').run(new Date().toISOString(),error.message,runId);
    console.error(JSON.stringify({ event:'current_civil_sync_failed',runId,error:error.message }));
    process.exitCode = 1;
  } finally { db.close(); }
}

if (require.main === module) main();
module.exports = { parseCivilCourt, parsePublicFeed, normalizeCourt, parseDate, checkRobots, makePackage, sha256 };

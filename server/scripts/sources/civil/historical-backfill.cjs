'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const WORK = path.join(ROOT, '_recovery-work', 'sprint142');
const DB_PATH = path.join(WORK, 'historical.sqlite');
const URL = 'https://www.csjn.gov.ar/tribunales-federales-nacionales/buscador-de-fallos.html';
const UA = 'BuscadorJuridicoCivil-Research/1.0 (+local audit)';

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find(value => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}
function text(value) {
  return decodeEntities(String(value)
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')).trim();
}
function decodeEntities(value) {
  return value
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
async function responseHtml(response) {
  const raw = Buffer.from(await response.arrayBuffer());
  const charset = response.headers.get('content-type')?.match(/charset=([^;\s]+)/i)?.[1] || 'utf-8';
  return new TextDecoder(charset).decode(raw);
}
function parsePage(html) {
  const visible = text(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' '));
  const totalMatch = visible.match(/([\d.]+)\s+Resultados encontrados/i);
  const total = totalMatch ? Number(totalMatch[1].replace(/\./g, '')) : null;
  const blocks = [...html.matchAll(/<div\s+class=["'']result["''][^>]*>([\s\S]*?)<\/div>/gi)];
  const results = [];
  for (const match of blocks) {
    const block = match[1];
    const id = block.match(/name=["']acc["']\s+value=["']showFile["'][^>]*>[\s\S]*?name=["']flid["']\s+value=["']?(\d+)/i)?.[1]
      || block.match(/name=["']flid["']\s+value=["']?(\d+)/i)?.[1];
    const fields = {};
    for (const li of block.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
      const item = li[1];
      const label = text(item.match(/<span\b[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '').toLowerCase().replace(/\s+/g, ' ');
      const value = text(item.replace(/<span\b[^>]*>[\s\S]*?<\/span>/i, ''));
      if (label.startsWith('jurisdicci')) fields.jurisdiccion = value;
      else if (label.startsWith('tribunal')) fields.tribunalOriginal = value;
      else if (label.startsWith('expediente')) fields.expediente = value;
      else if (label.startsWith('car')) fields.caratula = value;
      else if (label.startsWith('fecha')) fields.fechaSentencia = value;
    }
    if (!id) continue;
    const court = fields.tribunalOriginal || '';
    const isChamber = /^cámara nacional de apelaciones en lo civil(?:\s*,?\s*sala\s+[a-z]+)?$/i.test(court.trim());
    const isTrial = /^juzgado nacional(?: de primera instancia)? en lo civil(?:\s+(?:n(?:ro|º|°)?\s*)?\d+)?$/i.test(court.trim());
    const civilStatus = isChamber || isTrial ? 'CIVIL_EXACT' : court ? 'NON_CIVIL' : 'UNRESOLVED';
    const flid = Number(id);
    results.push({
      source: 'CSJN_TFN_HISTORICAL', sourceId: String(id), jurisdiccion: fields.jurisdiccion || null,
      tribunalOriginal: fields.tribunalOriginal || null, tribunalNormalizado: isChamber ? 'Cámara Nacional de Apelaciones en lo Civil' : isTrial ? 'Juzgado Nacional en lo Civil' : null,
      expediente: fields.expediente || null, caratula: fields.caratula || null,
      fechaSentencia: fields.fechaSentencia || null, detailUrl: null,
      downloadUrl: `${URL.replace(/buscador-de-fallos\.html$/, 'scp/include/showFile.php')} [POST acc=showFile, flid=${flid}]`,
      filename: null, pageNumber: null, discoveredAt: new Date().toISOString(),
      downloadStatus: 'PENDING_ROBOTS_DISALLOW', sha256: null, bytes: null,
      civilStatus, civilEvidence: isChamber ? 'tribunal estructurado exacto; filtro tid=18' : isTrial ? 'tribunal estructurado exacto' : court ? `tribunal estructurado: ${court}` : null,
      corpusStatus: 'NOT_RECONCILED',
    });
  }
  return { total, results };
}
function openDb() {
  fs.mkdirSync(WORK, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000; PRAGMA busy_timeout=10000;
    CREATE TABLE IF NOT EXISTS pages (page INTEGER PRIMARY KEY, status TEXT NOT NULL, attempts INTEGER NOT NULL, total INTEGER, result_count INTEGER NOT NULL DEFAULT 0, fetched_at TEXT, error TEXT);
    CREATE TABLE IF NOT EXISTS results (source_id TEXT PRIMARY KEY, source TEXT NOT NULL, jurisdiccion TEXT, tribunal_original TEXT, tribunal_normalizado TEXT, expediente TEXT, caratula TEXT, fecha_sentencia TEXT, detail_url TEXT, download_url TEXT, filename TEXT, page_number INTEGER NOT NULL, discovered_at TEXT NOT NULL, download_status TEXT NOT NULL, sha256 TEXT, bytes INTEGER, civil_status TEXT NOT NULL, civil_evidence TEXT, corpus_status TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_results_civil_status ON results(civil_status);
    CREATE INDEX IF NOT EXISTS idx_results_year ON results(substr(fecha_sentencia, 7, 4));
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  return db;
}
function record(db, key, value) {
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function fetchPage(page, timeoutMs) {
  const body = new URLSearchParams({ acc: 'search', pagina: String(page), jid: '', xid: '', tid: '', caratula: '', tags: '', mode: '', fecha_ini: '', fecha_ini_aux: '', fecha_fin: '', 'fecha-fin-aux': '' });
  const response = await fetch(URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
    body, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow',
  });
  return response;
}
async function crawl() {
  const db = openDb();
  const start = Number(arg('from-page', '0'));
  const pageLimit = Number(arg('max-pages', 'Infinity'));
  const delayMs = Number(arg('delay-ms', '1000'));
  const timeoutMs = Number(arg('timeout-ms', '45000'));
  const maxRetries = Number(arg('retries', '3'));
  const completed = db.prepare("SELECT page FROM pages WHERE status='COMPLETE'");
  const done = new Set(completed.all().map(row => row.page));
  const existingTotal = db.prepare("SELECT value FROM meta WHERE key='announced_total'").get()?.value;
  let total = existingTotal ? Number(existingTotal) : null;
  const initialPages = total ? Math.ceil(total / 20) : null;
  const end = Math.min(start + pageLimit, initialPages || Number.MAX_SAFE_INTEGER);
  let scannedNow = 0;
  console.log(JSON.stringify({ event: 'start', db: DB_PATH, url: URL, resumeCompletedPages: done.size, announcedTotal: total, delayMs, endPageExclusive: Number.isFinite(end) ? end : null }));
  for (let page = start; page < end; page++) {
    if (done.has(page)) continue;
    let success = false;
    let lastError = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetchPage(page, timeoutMs);
        const html = await responseHtml(response);
        if (response.status === 403 || response.status === 429) {
          lastError = `HTTP ${response.status}; no bypass attempted`;
          if (response.status === 429) {
            const seconds = Number(response.headers.get('retry-after'));
            const delay = Number.isFinite(seconds) ? seconds * 1000 : delayMs * 2 ** attempt;
            await wait(delay);
            continue;
          }
          break;
        }
        if (response.status >= 500 && attempt < maxRetries) {
          lastError = `HTTP ${response.status}`;
          await wait(delayMs * 2 ** attempt);
          continue;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const parsed = parsePage(html);
        if (parsed.total !== null) total = parsed.total;
        const expectedCount = total === null ? 20 : Math.max(0, Math.min(20, total - page * 20));
        if (parsed.results.length !== expectedCount) throw new Error(`Esperados ${expectedCount} registros y parseados ${parsed.results.length}`);
        const tx = db.prepare('INSERT INTO results(source_id,source,jurisdiccion,tribunal_original,tribunal_normalizado,expediente,caratula,fecha_sentencia,detail_url,download_url,filename,page_number,discovered_at,download_status,sha256,bytes,civil_status,civil_evidence,corpus_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET page_number=excluded.page_number,download_url=excluded.download_url');
        db.exec('BEGIN');
        try {
          for (const row of parsed.results) tx.run(row.sourceId,row.source,row.jurisdiccion,row.tribunalOriginal,row.tribunalNormalizado,row.expediente,row.caratula,row.fechaSentencia,row.detailUrl,row.downloadUrl,row.filename,page,row.discoveredAt,row.downloadStatus,row.sha256,row.bytes,row.civilStatus,row.civilEvidence,row.corpusStatus);
          db.prepare("INSERT INTO pages(page,status,attempts,total,result_count,fetched_at,error) VALUES(?, 'COMPLETE', ?, ?, ?, ?, NULL) ON CONFLICT(page) DO UPDATE SET status='COMPLETE',attempts=excluded.attempts,total=excluded.total,result_count=excluded.result_count,fetched_at=excluded.fetched_at,error=NULL").run(page,attempt,total,parsed.results.length,new Date().toISOString());
          if (total !== null) record(db, 'announced_total', total);
          record(db, 'last_page_completed', page);
          record(db, 'endpoint', URL);
          record(db, 'last_sync_at', new Date().toISOString());
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        scannedNow++;
        success = true;
        if (scannedNow % 25 === 0 || page === 0 || (total !== null && page + 1 === Math.ceil(total / 20))) {
          const counts = db.prepare("SELECT count(*) AS n, sum(CASE WHEN civil_status='CIVIL_EXACT' THEN 1 ELSE 0 END) AS civil FROM results").get();
          console.log(JSON.stringify({ event: 'progress', page, pagesScannedThisRun: scannedNow, resultsStored: counts.n, civilExact: counts.civil || 0, announcedTotal: total, pageResults: parsed.results.length }));
        }
        break;
      } catch (error) {
        lastError = error.message;
        if (attempt < maxRetries) await wait(delayMs * 2 ** (attempt - 1));
      }
    }
    if (!success) {
      db.prepare("INSERT INTO pages(page,status,attempts,total,result_count,fetched_at,error) VALUES(?, 'FAILED', ?, ?, 0, ?, ?) ON CONFLICT(page) DO UPDATE SET status='FAILED',attempts=excluded.attempts,total=excluded.total,fetched_at=excluded.fetched_at,error=excluded.error").run(page,maxRetries,total,new Date().toISOString(),lastError || 'unknown error');
      console.error(JSON.stringify({ event: 'page_failed', page, error: lastError }));
    }
    if (delayMs > 0) await wait(delayMs);
  }
  printStatus(db);
  db.close();
}
function printStatus(db) {
  const meta = Object.fromEntries(db.prepare('SELECT key,value FROM meta').all().map(row => [row.key,row.value]));
  const summary = db.prepare(`SELECT count(*) AS discovered,
    sum(CASE WHEN civil_status='CIVIL_EXACT' THEN 1 ELSE 0 END) AS civil,
    sum(CASE WHEN civil_status='NON_CIVIL' THEN 1 ELSE 0 END) AS non_civil,
    sum(CASE WHEN civil_status='UNRESOLVED' THEN 1 ELSE 0 END) AS unresolved,
    sum(CASE WHEN civil_status='CIVIL_EXACT' AND NOT EXISTS(SELECT 1 FROM downloads d WHERE d.source_id=results.source_id AND d.status IN ('VERIFIED','ALREADY_LOCAL')) THEN 1 ELSE 0 END) AS civil_pdf_pending
    FROM results`).get();
  const pages = db.prepare("SELECT status,count(*) AS n FROM pages GROUP BY status").all();
  const civilPages = db.prepare("SELECT status,count(*) AS n FROM civil_filter_pages GROUP BY status").all();
  const downloads = db.prepare("SELECT status,count(*) AS n,coalesce(sum(bytes),0) AS bytes FROM downloads GROUP BY status").all();
  const byCourt = db.prepare("SELECT coalesce(tribunal_original,'(sin tribunal)') AS court,count(*) AS n FROM results WHERE civil_status='CIVIL_EXACT' GROUP BY court ORDER BY n DESC").all();
  const years = db.prepare(`SELECT substr(fecha_sentencia,7,4) AS year,count(*) AS n FROM results WHERE civil_status='CIVIL_EXACT' AND fecha_sentencia GLOB '??/??/????' GROUP BY year ORDER BY year`).all();
  console.log(JSON.stringify({ event: 'status', manifest: DB_PATH, announcedTotal: Number(meta.announced_total || 0), ...summary, pages, civilFilterPages: civilPages, downloads, byCourt, civilByYear: years, lastPage: meta.last_page_completed || null, lastSyncAt: meta.last_sync_at || null }, null, 2));
}

if (require.main === module) {
  if (process.argv.includes('--status')) { const db = openDb(); printStatus(db); db.close(); }
  else crawl().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}
module.exports = { parsePage, decodeEntities, responseHtml };

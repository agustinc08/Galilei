'use strict';

// Human-in-the-loop, headed-browser backfill for the CSJN current Civil form.
// The user solves the official cap-widget in the visible browser. This program
// never reads, logs, injects, copies, or synthesizes its challenge token.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const BACK = path.join(ROOT, 'JurisprudenciaN', 'back');
const WORK = path.join(ROOT, '_recovery-work', 'sprint144', 'current-session');
const DB_PATH = path.join(WORK, 'checkpoint.sqlite');
const PROFILE = path.join(WORK, 'browser-profile');
const SOURCE_URL = 'https://www.csjn.gov.ar/tribunales-federales-nacionales/sentencias.html';
const SOURCE_CODE = 'TFN_ACTUAL_CIVIL';
const DELAY_MS = Math.max(0, Number(process.env.CIVIL_HARVEST_DELAY_MS || 750));
const BATCH_SIZE = Math.max(1, Number(process.env.CIVIL_HARVEST_BATCH_SIZE || 20));
const PAGE_LIMIT = Math.max(0, Number(process.env.CIVIL_HARVEST_MAX_PAGES || 0));
const DO_IMPORT = process.argv.includes('--import');

function loadPlaywright() {
  try { return require('playwright'); }
  catch (firstError) {
    const fallback = path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright');
    try { return require(fallback); }
    catch { throw new Error(`Playwright no está disponible (${firstError.message}).`); }
  }
}
const { chromium } = loadPlaywright();
const parsePublicFeed = require('./current-civil-feed-sync.cjs').parsePublicFeed;

fs.mkdirSync(WORK, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;
CREATE TABLE IF NOT EXISTS runs (run_id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, query_from TEXT NOT NULL, query_to TEXT NOT NULL, browser TEXT NOT NULL, error TEXT);
CREATE TABLE IF NOT EXISTS pages (run_id TEXT NOT NULL, page_no INTEGER NOT NULL, status TEXT NOT NULL, result_count INTEGER NOT NULL DEFAULT 0, civil_count INTEGER NOT NULL DEFAULT 0, captured_at TEXT, error TEXT, PRIMARY KEY(run_id,page_no));
CREATE TABLE IF NOT EXISTS records (external_id TEXT PRIMARY KEY, source_page INTEGER NOT NULL, tribunal TEXT NOT NULL, court_type TEXT NOT NULL, chamber TEXT, instance TEXT NOT NULL, case_number TEXT, title TEXT, date_text TEXT, decision_date TEXT, pdf_url TEXT NOT NULL, discovered_at TEXT NOT NULL, download_status TEXT NOT NULL DEFAULT 'DISCOVERED', http_status INTEGER, mime_type TEXT, sha256 TEXT, bytes INTEGER, file_path TEXT, corpus_status TEXT NOT NULL DEFAULT 'NOT_IMPORTED', error TEXT);
CREATE INDEX IF NOT EXISTS current_session_sha_idx ON records(sha256);
CREATE INDEX IF NOT EXISTS current_session_case_idx ON records(case_number,decision_date);
`);
const recordGet = db.prepare('SELECT * FROM records WHERE external_id=?');
const recordPut = db.prepare(`INSERT INTO records(external_id,source_page,tribunal,court_type,chamber,instance,case_number,title,date_text,decision_date,pdf_url,discovered_at)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(external_id) DO UPDATE SET source_page=excluded.source_page,tribunal=excluded.tribunal,court_type=excluded.court_type,chamber=excluded.chamber,instance=excluded.instance,case_number=excluded.case_number,title=excluded.title,date_text=excluded.date_text,decision_date=excluded.decision_date,pdf_url=excluded.pdf_url`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function guard(args) {
  const result = spawnSync(process.execPath, [path.join(BACK, 'scripts', 'with-dev-db-guard.cjs'), ...args], {
    cwd: BACK, encoding: 'utf8', env: process.env, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`DEV_GUARD_FAILED:${args.join(' ')}:${result.status}`);
  return result.stdout || '';
}

function makePackage(records, batchNumber) {
  const unique = new Map();
  for (const record of records) if (record.sha256 && !unique.has(record.sha256)) unique.set(record.sha256, record);
  const batchKey = [...unique.values()].map(r => r.external_id).sort().join('\n');
  const packageId = `civil-current-session-${sha256(Buffer.from(batchKey)).slice(0, 16)}`;
  const packageRoot = path.join(WORK, 'packages', packageId);
  const files = path.join(packageRoot, 'files');
  fs.mkdirSync(files, { recursive: true });
  const documents = [];
  for (const row of unique.values()) {
    const filename = `${row.sha256}.pdf`;
    fs.copyFileSync(row.file_path, path.join(files, filename));
    documents.push({ path: filename, filename, externalId: `TFN_ACTUAL:${row.external_id}`,
      sourceReference: [row.case_number, row.tribunal].filter(Boolean).join(' — '), sourceUrl: SOURCE_URL,
      decisionDate: row.decision_date || undefined, caseNumber: row.case_number || undefined,
      title: row.title || undefined, court: row.tribunal, chamber: row.chamber || undefined,
      instance: row.instance, documentType: 'JURISPRUDENCIA', mimeType: 'application/pdf',
      sha256: row.sha256, visibility: 'INTERNAL',
      metadata: { sourceCode: SOURCE_CODE, acquisitionMode: 'HUMAN_SESSION_FILTERED', externalId: row.external_id,
        tribunal: row.tribunal, chamber: row.chamber, caseNumber: row.case_number, decisionDate: row.decision_date },
      metadataOriginal: { source: 'CSJN_CURRENT_FILTERED_HUMAN_SESSION', externalId: row.external_id,
        sourcePage: row.source_page, pdfUrl: row.pdf_url, httpStatus: row.http_status,
        mimeType: row.mime_type, sha256: row.sha256, bytes: row.bytes } });
  }
  const manifest = { schemaVersion: '1.0', packageId, generatedAt: new Date().toISOString(),
    source: { code: SOURCE_CODE, name: 'CSJN — buscador actual TFN (Civil, sesión humana)', type: 'OFFICIAL_PUBLIC_JURISPRUDENCE', baseUrl: SOURCE_URL },
    documents: documents };
  fs.writeFileSync(path.join(packageRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { packageId, packageRoot, documents: documents.length, batchNumber };
}

async function importBatch(rows, batchNumber) {
  const pkg = makePackage(rows, batchNumber);
  const dry = guard(['corpus-package', 'dry-run', pkg.packageRoot]);
  if (!DO_IMPORT) return { ...pkg, dryRun: dry, imported: false };
  const imported = guard(['corpus-package', 'import', pkg.packageRoot]);
  if (!/"status"\s*:\s*"(?:SUCCESS|ALREADY_IMPORTED)"/.test(imported)) throw new Error(`CORPUS_IMPORT_NOT_COMPLETE:${pkg.packageId}`);
  const mark = db.prepare("UPDATE records SET corpus_status='IMPORTED' WHERE external_id=?");
  for (const row of rows) mark.run(row.external_id);
  guard(['sprint122-search-projection-verify']);
  return { ...pkg, dryRun: dry, importReceipt: imported, imported: true };
}

async function extractCards(page, pageNo, runId) {
  const cardHtml = await page.locator('div.result').evaluateAll(nodes => nodes.map(node => node.outerHTML));
  if (!cardHtml.length) {
    const challengeVisible = await page.locator('cap-widget').count() > 0;
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const status = challengeVisible ? 'HUMAN_CHALLENGE_REQUIRED' : /no se encontraron|sin resultados/i.test(bodyText) ? 'COMPLETE_ZERO' : 'UNPARSED_RESULTS';
    db.prepare('INSERT INTO pages(run_id,page_no,status,result_count,civil_count,captured_at,error) VALUES(?,?,?,0,0,?,?) ON CONFLICT(run_id,page_no) DO UPDATE SET status=excluded.status,captured_at=excluded.captured_at,error=excluded.error')
      .run(runId,pageNo,status,new Date().toISOString(),status === 'UNPARSED_RESULTS' ? 'No hay tarjetas div.result reconocibles; conservar límite visible y revisar selector.' : null);
    return { status, items: [], cards: [] };
  }
  // Only card HTML is read. The form and challenge DOM, including its token
  // field, are deliberately never serialized or inspected.
  const parsed = parsePublicFeed(cardHtml.join('\n'), new Date().toISOString());
  const records = parsed.civil.filter(item => item.pdfUrl);
  const status = records.length === 0 ? 'UNPARSED_RESULTS' : 'COMPLETE';
  db.prepare('INSERT INTO pages(run_id,page_no,status,result_count,civil_count,captured_at,error) VALUES(?,?,?,?,?,?,?) ON CONFLICT(run_id,page_no) DO UPDATE SET status=excluded.status,result_count=excluded.result_count,civil_count=excluded.civil_count,captured_at=excluded.captured_at,error=excluded.error')
    .run(runId,pageNo,status,parsed.resultCount,records.length,new Date().toISOString(),status === 'UNPARSED_RESULTS' ? 'Cards rendered but parser found no Civil items with a visible Descargar link.' : null);
  for (const item of records) recordPut.run(item.externalId,pageNo,item.tribunal,item.normalizedCourt,item.chamber,item.instance,item.caseNumber,item.title,item.dateText,item.decisionDate,item.pdfUrl,item.discoveredAt);
  return { status, items: records, cards: cardHtml };
}

async function downloadVisiblePdf(context, item) {
  const current = recordGet.get(item.externalId);
  if (current?.download_status === 'VERIFIED' && current.file_path && fs.existsSync(current.file_path)) return { status: 'ALREADY_VERIFIED', row: current };
  await sleep(DELAY_MS);
  // This GET uses only the literal Descargar URL found inside a rendered result card.
  const response = await context.request.get(item.pdfUrl, { timeout: 60000, maxRedirects: 5 });
  const contentType = response.headers()['content-type'] || '';
  if (response.status() === 403 || response.status() === 429) throw new Error(`POLICY_STOP_HTTP_${response.status()}; no bypass`);
  const bytes = await response.body();
  if (response.status() !== 200 || !/^application\/pdf(?:\s*;|$)/i.test(contentType) || bytes.length < 5 || bytes.subarray(0,5).toString('ascii') !== '%PDF-') {
    db.prepare("UPDATE records SET download_status='FAILED',http_status=?,mime_type=?,bytes=?,error=? WHERE external_id=?")
      .run(response.status(),contentType,bytes.length,`HTTP ${response.status()}; MIME ${contentType}; firma ${bytes.subarray(0,5).toString('ascii')}`,item.externalId);
    return { status: 'FAILED' };
  }
  const checksum = sha256(bytes);
  const objects = path.join(WORK, 'objects');
  fs.mkdirSync(objects, { recursive: true });
  const filePath = path.join(objects, `${checksum}.pdf`);
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, bytes, { flag: 'wx' });
  db.prepare("UPDATE records SET download_status='VERIFIED',http_status=?,mime_type=?,sha256=?,bytes=?,file_path=?,error=NULL WHERE external_id=?")
    .run(response.status(),contentType,checksum,bytes.length,filePath,item.externalId);
  return { status: 'VERIFIED', row: recordGet.get(item.externalId) };
}

async function harvestPage(context, page, pageNo, runId, batchNumber) {
  const snapshot = await extractCards(page, pageNo, runId);
  if (snapshot.status === 'HUMAN_CHALLENGE_REQUIRED') throw new Error('PAGE_CHALLENGE_REQUIRED: no se automatiza el challenge por página.');
  if (snapshot.status !== 'COMPLETE') return { status: snapshot.status, civil: 0, verified: 0, imported: 0, batchNumber };
  let verified = 0, failures = 0;
  let batch = [];
  const packages = [];
  for (const item of snapshot.items) {
    const result = await downloadVisiblePdf(context,item);
    if (result.status === 'VERIFIED' || result.status === 'ALREADY_VERIFIED') { verified++; batch.push(result.row); }
    else failures++;
    if (batch.length >= BATCH_SIZE) {
      packages.push(await importBatch(batch,++batchNumber)); batch=[];
    }
  }
  if (batch.length) packages.push(await importBatch(batch,++batchNumber));
  const safeCardHtml = snapshot.cards.join('\n');
  const htmlPath = path.join(WORK,'pages',`page-${String(pageNo).padStart(5,'0')}.cards.html`);
  fs.mkdirSync(path.dirname(htmlPath),{recursive:true});
  fs.writeFileSync(htmlPath,safeCardHtml,'utf8');
  return { status: 'COMPLETE', pageNo, resultCards: snapshot.cards.length, civil: snapshot.items.length, verified, failures, packages, batchNumber };
}

async function clickNext(page) {
  const controls = page.locator('.pagination a, .pagination button, a.page-link, button.page-link, a[onclick*="irPaginaF"]');
  const count = await controls.count();
  let candidate = null;
  let nextNumber = Number.POSITIVE_INFINITY;
  const currentPage = Number(await page.locator('#fallos [name="pagina"]').inputValue().catch(() => '0')) || 0;
  for (let i=0;i<count;i++) {
    const control = controls.nth(i);
    const text = ((await control.innerText().catch(()=>'')) || '').trim();
    const aria = await control.getAttribute('aria-label').catch(()=>null) || '';
    const onclick = await control.getAttribute('onclick').catch(()=>null) || '';
    const disabled = await control.getAttribute('aria-disabled').catch(()=>null);
    const cls = await control.getAttribute('class').catch(()=>null) || '';
    if (disabled === 'true' || /disabled/i.test(cls)) continue;
    const pageNumber = onclick.match(/irPaginaF\s*\(\s*(\d+)\s*\)/i)?.[1];
    if (pageNumber && Number(pageNumber) > currentPage && Number(pageNumber) < nextNumber) {
      nextNumber = Number(pageNumber);
      candidate = control;
      continue;
    }
    if (/^(siguiente|next|›|»|>|⟩)$/i.test(text) || /siguiente|next/i.test(aria)) { candidate=control; break; }
  }
  if (!candidate) return false;
  const nextResponse = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith('/sentencias.html'), { timeout: 30000 });
  await candidate.click();
  await nextResponse;
  await page.waitForLoadState('domcontentloaded').catch(()=>{});
  await page.waitForTimeout(350);
  return true;
}

async function main() {
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const dateFrom = '21/08/2013', dateTo = '09/10/2026';
  db.prepare('INSERT INTO runs(run_id,started_at,status,query_from,query_to,browser) VALUES(?,?,?,?,?,?)')
    .run(runId,startedAt,'PREPARING',dateFrom,dateTo,'Microsoft Edge headed / persistent isolated profile');
  let context;
  try {
    context = await chromium.launchPersistentContext(PROFILE, { channel: 'msedge', headless: false, acceptDownloads: true,
      viewport: { width: 1365, height: 950 }, locale: 'es-AR', args: ['--start-maximized'] });
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(30000);
    await page.goto(SOURCE_URL,{waitUntil:'domcontentloaded',timeout:60000});
    await page.locator('#fallos').waitFor({state:'visible'});
    // Prepare the standard visible Civil search fields. The challenge stays
    // untouched for the user; no form is submitted here.
    const tribunalOptionsLoaded = page.waitForResponse(response =>
      new URL(response.url()).pathname.endsWith('/ajax/request_tribunales_fallos_new.php'), { timeout: 30000 });
    await page.locator('#fallos #jurisdiccion').selectOption('5-5');
    await tribunalOptionsLoaded;
    await page.locator('#selector-camara option[value="C_1"]').waitFor({ state: 'attached', timeout: 30000 });
    const chamberSelected = page.waitForResponse(response =>
      new URL(response.url()).pathname.endsWith('/ajax/request_tribunales_fallos_new.php'), { timeout: 30000 });
    await page.locator('#selector-camara').selectOption('C_1');
    await chamberSelected;
    await page.waitForFunction(() => document.querySelector('#tid')?.value === 'C_1', { timeout: 30000 });
    await page.locator('#fecha_fallo_desde_aux').fill('');
    await page.locator('#fecha_fallo_desde_aux').pressSequentially(dateFrom);
    await page.locator('#fecha_fallo_desde_aux').press('Tab');
    await page.locator('#fecha_fallo_hasta_aux').fill('');
    await page.locator('#fecha_fallo_hasta_aux').pressSequentially(dateTo);
    await page.locator('#fecha_fallo_hasta_aux').press('Tab');
    const prepared = {
      jurisdiction: await page.locator('#fallos #jurisdiccion').inputValue(),
      chamber: await page.locator('#selector-camara').inputValue(),
      selectedOfficeType: await page.locator('#selector-tipo').inputValue().catch(()=>''),
      tribunalFilter: await page.locator('#selector-tribunal').inputValue().catch(()=>''),
      tid: await page.locator('#tid').inputValue(),
      dateFrom: await page.locator('#fecha_fallo_desde').inputValue(),
      dateTo: await page.locator('#fecha_fallo_hasta').inputValue(),
    };
    if (prepared.chamber !== 'C_1' || prepared.tid !== 'C_1' || prepared.dateFrom !== '2013-08-21' || prepared.dateTo !== '2026-10-09') {
      throw new Error(`VISIBLE_FILTER_PREPARATION_FAILED:${JSON.stringify(prepared)}`);
    }
    db.prepare("UPDATE runs SET status='WAITING_HUMAN_CHALLENGE' WHERE run_id=?").run(runId);
    console.log(JSON.stringify({ event:'civil_harvest_ready_for_human',runId,sourceUrl:SOURCE_URL,filters:prepared,
      instruction:'En la ventana de Edge, resolvé cap-widget. Luego pulsa Buscar una vez; no hay que copiar HTML ni tokens.',
      challengeSolvedByScript:false,challengeTokenRead:false,challengeTokenStored:false }));

    // Wait for the normal form submission initiated in the visible browser.
    const firstResponse = await page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname.endsWith('/sentencias.html'), { timeout: 0 });
    if (firstResponse.status() === 403 || firstResponse.status() === 429) throw new Error(`POLICY_STOP_HTTP_${firstResponse.status()}; no bypass`);
    await page.waitForLoadState('domcontentloaded').catch(()=>{});
    await page.waitForTimeout(500);
    const responseCards = await page.locator('div.result').count();
    if (!responseCards && await page.locator('cap-widget').count()) throw new Error('HUMAN_CHALLENGE_NOT_COMPLETED_OR_SEARCH_NOT_SUBMITTED');
    db.prepare("UPDATE runs SET status='HARVESTING' WHERE run_id=?").run(runId);
    let pageNo = 0, batchNumber = 0, totalCivil = 0, totalVerified = 0, totalFailures = 0;
    const pageResults = [];
    for (;;) {
      const result = await harvestPage(context,page,pageNo,runId,batchNumber);
      pageResults.push(result);
      batchNumber = result.batchNumber || batchNumber;
      totalCivil += result.civil || 0;
      totalVerified += result.verified || 0;
      totalFailures += result.failures || 0;
      console.log(JSON.stringify({ event:'civil_harvest_page',runId,...result,totalCivil,totalVerified,totalFailures }));
      if (result.status !== 'COMPLETE') break;
      if (PAGE_LIMIT && pageNo + 1 >= PAGE_LIMIT) break;
      const advanced = await clickNext(page);
      if (!advanced) break;
      pageNo++;
      if (await page.locator('cap-widget').count() && await page.locator('div.result').count() === 0) {
        throw new Error('PAGINATION_CHALLENGE_REQUIRED: no retry or challenge reuse.');
      }
    }
    const finalStatus = totalFailures ? 'PARTIAL_DOWNLOAD_FAILURE' : pageResults.some(p=>p.status!=='COMPLETE') ? 'PARTIAL' : 'PARTIAL_BOUNDED_FEED';
    db.prepare('UPDATE runs SET finished_at=?,status=? WHERE run_id=?').run(new Date().toISOString(),finalStatus,runId);
    console.log(JSON.stringify({ event:'civil_harvest_finished',runId,status:finalStatus,pages:pageResults.length,civilCards:totalCivil,
      verifiedPdfs:totalVerified,downloadFailures:totalFailures,checkpoint:DB_PATH,challengeSolvedByScript:false,
      challengeTokenRead:false,challengeTokenStored:false,challengeTokenInjected:false,paginationStatus:'VISIBLE_CONTROLS_ONLY' },null,2));
  } catch (error) {
    db.prepare('UPDATE runs SET finished_at=?,status=?,error=? WHERE run_id=?').run(new Date().toISOString(),'PARTIAL_OR_BLOCKED',String(error.message||error),runId);
    console.error(JSON.stringify({ event:'civil_harvest_stopped',runId,error:String(error.message||error),checkpoint:DB_PATH,
      challengeSolvedByScript:false,challengeTokenRead:false,challengeTokenStored:false,challengeTokenInjected:false }));
    process.exitCode = 1;
  } finally {
    // When a challenge is still visible, keep the browser open so the user can
    // finish the normal page action. Otherwise close the isolated profile cleanly.
    if (context) {
      const pages = context.pages();
      const humanStillNeeded = pages.some(p => p.url().includes('sentencias.html')) && (await pages[0].locator('cap-widget').count().catch(()=>0) > 0) && (await pages[0].locator('div.result').count().catch(()=>0) === 0);
      if (!humanStillNeeded) await context.close().catch(()=>{});
    }
    db.close();
  }
}

main();

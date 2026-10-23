'use strict';

// Imports files saved by a person after a normal official-site session.
// This helper never opens a browser, sends the filtered search, reads CAPTCHA
// tokens, or fetches source URLs. The saved HTML and PDFs are read-only inputs.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parsePublicFeed, makePackage, sha256 } = require('./current-civil-feed-sync.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const BACK = path.join(ROOT, 'server');
const args = process.argv.slice(2);
function option(name) {
  const value = args.find(arg => arg.startsWith(`--${name}=`));
  return value ? value.slice(name.length + 3) : null;
}
function fail(message) { throw new Error(message); }
function invokeGuard(packageRoot, operation, env = {}) {
  const child = spawnSync(process.execPath, [
    path.join(BACK, 'scripts', 'with-dev-db-guard.cjs'), 'corpus-package', operation, packageRoot,
  ], {
    cwd: BACK,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.status !== 0) fail(`DEV DB guard falló en corpus-package ${operation} (exit ${child.status}).`);
  return child.stdout || '';
}
function verify(record) {
  const child = spawnSync(process.execPath, [path.join(BACK, 'scripts', 'with-dev-db-guard.cjs'), 'civil-current-verify'], {
    cwd: BACK,
    encoding: 'utf8',
    env: {
      ...process.env,
      BJC_CIVIL_CURRENT_EXTERNAL_ID: `TFN_ACTUAL:${record.externalId}`,
      BJC_CIVIL_CURRENT_CASE_NUMBER: record.caseNumber,
    },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.status !== 0) fail(`DEV DB guard no verificó Search/visor para ${record.caseNumber}.`);
}

async function main() {
  const htmlPath = option('html');
  const pdfDir = option('pdf-dir');
  if (!htmlPath || !pdfDir) fail('Uso: pnpm civil:import:session -- --html=<html-guardado> --pdf-dir=<carpeta-con-PDFs>');
  const htmlAbsolute = path.resolve(htmlPath);
  const pdfAbsolute = path.resolve(pdfDir);
  if (!fs.statSync(htmlAbsolute).isFile()) fail('--html debe señalar un archivo HTML guardado.');
  if (!fs.statSync(pdfAbsolute).isDirectory()) fail('--pdf-dir debe señalar una carpeta existente.');
  const htmlBytes = fs.readFileSync(htmlAbsolute);
  const charset = htmlBytes.subarray(0, 4096).toString('ascii').match(/charset=["']?([^\s"';>]+)/i)?.[1] || 'utf-8';
  const html = new TextDecoder(charset).decode(htmlBytes);
  const parsed = parsePublicFeed(html, new Date().toISOString());
  const civilRecords = [...new Map(parsed.civil.map(record => [record.externalId, record])).values()];
  if (civilRecords.length === 0) fail('El HTML guardado no contiene tarjetas de los tribunales civiles admitidos.');
  if (civilRecords.some(record => !record.caseNumber)) fail('Hay una tarjeta Civil sin expediente; se detuvo para evitar una verificación ambigua.');

  const files = fs.readdirSync(pdfAbsolute, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'))
    .map(entry => ({ name: entry.name, fullPath: path.join(pdfAbsolute, entry.name) }));
  let importedNew = 0;
  let alreadyPresent = 0;
  let pending = 0;
  for (const record of civilRecords) {
    const expected = path.posix.basename(new URL(record.pdfUrl).pathname).toLowerCase();
    const matches = files.filter(file => file.name.toLowerCase() === expected);
    if (matches.length !== 1) {
      pending += 1;
      console.log(JSON.stringify({ event: 'manual_civil_pending_pdf', externalId: record.externalId, caseNumber: record.caseNumber, expectedFilename: expected, matches: matches.length }));
      continue;
    }
    const bytes = fs.readFileSync(matches[0].fullPath);
    if (bytes.length < 5 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
      pending += 1;
      console.log(JSON.stringify({ event: 'manual_civil_invalid_pdf', externalId: record.externalId, caseNumber: record.caseNumber, filename: matches[0].name }));
      continue;
    }
    const checksum = sha256(bytes);
    const objectPath = path.join(ROOT, '_recovery-work', 'sprint143', 'objects', `${checksum}.pdf`);
    fs.mkdirSync(path.dirname(objectPath), { recursive: true });
    if (!fs.existsSync(objectPath)) fs.copyFileSync(matches[0].fullPath, objectPath, fs.constants.COPYFILE_EXCL);
    const pkg = await makePackage(record, {
      status: 'VERIFIED', httpStatus: null, contentType: 'application/pdf',
      sha256: checksum, bytes: bytes.length, filePath: objectPath,
      acquisitionMode: 'HUMAN_SESSION_IMPORT',
    });
    invokeGuard(pkg.packageRoot, 'dry-run');
    const receipt = invokeGuard(pkg.packageRoot, 'import');
    verify(record);
    const alreadyImported = /"status"\s*:\s*"ALREADY_IMPORTED"/.test(receipt);
    if (alreadyImported) alreadyPresent += 1; else importedNew += 1;
    console.log(JSON.stringify({ event: alreadyImported ? 'manual_civil_already_present' : 'manual_civil_imported', externalId: record.externalId, court: record.tribunal, caseNumber: record.caseNumber, decisionDate: record.decisionDate, sha256: checksum, bytes: bytes.length, packageId: pkg.packageId }));
  }
  console.log(JSON.stringify({ event: 'manual_civil_session_complete', resultsInSavedHtml: parsed.resultCount, civilResults: civilRecords.length, importedNew, alreadyPresent, pending, captchaSolvedByThisTool: false, externalNetworkRequestsMade: 0 }, null, 2));
  if (pending) process.exitCode = 2;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseCsv, readInput, normalizeRows, reconcile, makeAcquisitionManifest, statsOnly } = require('./intake.cjs');

const fixturePath = path.join(__dirname, 'fixtures', 'authorized-export-synthetic.csv');
function valid(id, docket, courtNo, date, extra = {}) {
  return { source_record_id: id, fuero: 'Civil', jurisdiccion: 'Nacional', instancia: 'Primera Instancia',
    organo: `Juzgado Nacional de Primera Instancia en lo Civil N° ${courtNo}`, juzgado_numero: String(courtNo),
    expediente: `CIV ${docket}`, expediente_anio: docket.split('/')[1], fecha_decision: date, caratula: `DEMO ${id}`, ...extra };
}

test('32-row fixture includes civil, chambers, duplicates, errors, scope, URLs and accents', () => {
  const parsed = readInput(fixturePath);
  assert.equal(parsed.format, 'CSV');
  assert.equal(parsed.rows.length, 32);
  assert.equal(parsed.rows.find(x=>x.row.source_record_id==='synthetic-030').row.caratula, 'NIÑO ÑANDÚ c/ DEMOSTRACIÓN');
  assert.ok(parsed.rows.some(x=>x.row.source_record_id==='synthetic-001' && x.row.expediente==='CIV 10001/2020'));
  assert.ok(parsed.rows.some(x=>!x.row.source_record_id));
  const normalized=normalizeRows(parsed.rows,{source:'SIMULATED_NOT_REAL'});
  assert.equal(normalized.summary.duplicateSourceIds.find(x=>x.sourceRecordId==='synthetic-001').classification,'DUPLICATE_IDENTICAL');
  assert.equal(normalized.summary.duplicateSourceIds.find(x=>x.sourceRecordId==='synthetic-002').classification,'DUPLICATE_CONFLICT');
  assert.equal(normalized.summary.legalIdentityDuplicates.length,1);
  assert.ok(normalized.errors.some(x=>x.errorCode==='INVALID_DATE'));
  assert.ok(normalized.errors.some(x=>x.errorCode==='UNKNOWN_COURT'));
});

test('CSV comma, semicolon, BOM, quoting and malformed-row continuation', () => {
  assert.equal(parseCsv('\uFEFFid,title\n1,"A, B ""C"""\n').rows[0].row.title, 'A, B "C"');
  const semi = parseCsv('id;title\n1;"A; B"\n');
  assert.equal(semi.delimiter, ';');
  assert.equal(semi.rows[0].row.title, 'A; B');
  const malformed = parseCsv('id,name\n1,ok\n2,extra,field\n3,ok\n');
  assert.equal(malformed.rows.length, 3);
  assert.equal(malformed.rows[1].parseIssues[0].code, 'MALFORMED_ROW');
  assert.throws(() => parseCsv('id,title\n1,"open'), /CSV_UNCLOSED_QUOTE/u);
});

test('JSON and NDJSON parse; unsupported and invalid UTF-8 fail clearly', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bjc-intake-'));
  try {
    const json = path.join(temp, 'x.json'); fs.writeFileSync(json, JSON.stringify([valid('a','1/2020',1,'2020-01-02')]));
    assert.equal(readInput(json).rows.length, 1);
    const ndjson = path.join(temp, 'x.ndjson'); fs.writeFileSync(ndjson, '{"a":1}\nnope\n{"b":2}\n');
    assert.equal(readInput(ndjson).rows[1].parseIssues[0].code, 'MALFORMED_ROW');
    const bad = path.join(temp, 'bad.json'); fs.writeFileSync(bad, Buffer.from([0xc3, 0x28]));
    assert.throws(() => readInput(bad), /INVALID_UTF8/u);
    const xlsx = path.join(temp, 'x.xlsx'); fs.writeFileSync(xlsx, '');
    assert.throws(() => readInput(xlsx), /UNSUPPORTED_FORMAT/u);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('required metadata, invalid date/case/URL, unknown court and duplicate classes are retained row-wise', () => {
  const identical = valid('dup-ident','1/2020',1,'2020-01-02');
  const input = [identical, {...identical}, valid('dup-conflict','2/2020',2,'2020-01-02'), valid('dup-conflict','3/2020',2,'2020-01-03'),
    valid('bad-date','4/2020',4,'31/02/2020'), {...valid('', '5/2020',5,'2020-01-02'), source_record_id:''},
    {...valid('unknown','6/2020',6,'2020-01-02'), organo:'Órgano Judicial Desconocido'},
    {...valid('bad-url','7/2020',7,'2020-01-02'), url_documento:'javascript:alert(1)'},
    {...valid('bad-case','not-a-case',8,'2020-01-02')}];
  const result = normalizeRows(input.map((row,i)=>({row,rowNumber:i+2})), {source:'synthetic'});
  const codes = result.errors.map(x=>x.errorCode);
  assert.ok(codes.includes('MISSING_REQUIRED'));
  assert.ok(codes.includes('INVALID_DATE'));
  assert.ok(codes.includes('INVALID_CASE'));
  assert.ok(codes.includes('UNKNOWN_COURT'));
  assert.ok(codes.includes('INVALID_URL'));
  assert.ok(codes.includes('DUPLICATE_SOURCE_ID'));
  assert.ok(codes.includes('CONFLICTING_SOURCE_ID'));
  assert.equal(result.summary.duplicateSourceIds.find(x=>x.sourceRecordId==='dup-ident').classification, 'DUPLICATE_IDENTICAL');
  assert.equal(result.summary.duplicateSourceIds.find(x=>x.sourceRecordId==='dup-conflict').classification, 'DUPLICATE_CONFLICT');
  assert.equal(result.snapshot.records.find(x=>x.sourceRecordId==='dup-conflict').validationStatus, 'REVIEW');
});

test('conflicting alias columns require explicit mapping instead of silent selection', () => {
  const row={...valid('alias','9/2020',9,'2020-01-02'),court:'Juzgado Civil 9',organo:'Juzgado Civil 10'};
  const automatic=normalizeRows([{row,rowNumber:2}]);
  assert.ok(automatic.errors.some(x=>x.errorCode==='AMBIGUOUS_COLUMN_MAPPING'&&x.field==='court'));
  assert.equal(automatic.snapshot.records[0].court,null);
  const mapped=normalizeRows([{row,rowNumber:2}],{mapping:{court:'court'}});
  assert.equal(mapped.snapshot.records[0].court,'Juzgado Civil 9');
  assert.ok(!mapped.errors.some(x=>x.errorCode==='AMBIGUOUS_COLUMN_MAPPING'&&x.field==='court'));
});

test('scope is detected without dropping chamber and other-jurisdiction rows', () => {
  const input = [valid('civil','1/2020',1,'2020-01-02'), {...valid('chamber','2/2020',2,'2020-01-02'), organo:'Cámara Nacional de Apelaciones en lo Civil', instancia:'Segunda Instancia'},
    {...valid('laboral','3/2020',3,'2020-01-02'), fuero:'Laboral', organo:'Juzgado Nacional del Trabajo N° 3'}, {...valid('unknown','4/2020',4,'2020-01-02'),organo:'Tribunal no clasificado'}];
  const result = normalizeRows(input.map((row,i)=>({row,rowNumber:i+1})));
  assert.deepEqual(Object.fromEntries(result.snapshot.records.map(x=>[x.sourceRecordId,x.scope])), {
    civil:'IN_SCOPE', chamber:'OUT_OF_REQUESTED_SCOPE', laboral:'OUT_OF_REQUESTED_SCOPE', unknown:'UNKNOWN_SCOPE' });
  assert.equal(result.summary.outOfScope, 2);
});

test('court number is extracted conservatively while original court name and secretary remain separate', () => {
  const row={sourceRecordId:'court-number',fuero:'Civil',court:'Juzgado Nacional de Primera Instancia en lo Civil N° 7',expediente:'CIV 7/2020',decisionDate:'2021-01-01',secretary:'94'};
  const record=normalizeRows([{row,rowNumber:2}]).snapshot.records[0];
  assert.equal(record.court,'Juzgado Nacional de Primera Instancia en lo Civil N° 7');
  assert.equal(record.courtNumber,'7');
  assert.equal(record.secretary,'94');
  assert.equal(record.expedienteYear,'2020');
  assert.equal(record.decisionYear,'2021');
});

test('reconciliation is deterministic for EXACT, HIGH, MEDIUM, CONFLICT and UNMATCHED', () => {
  const input = [valid('native-1','101/2020',1,'2021-01-01'), valid('high-source','102/2020',2,'2021-02-02'), valid('medium-source','103/2020',3,'2021-03-03'), valid('conflict-source','104/2020',4,'2021-04-04'), valid('gap-source','105/2020',5,'2021-05-05')];
  const intake = normalizeRows(input.map((row,i)=>({row,rowNumber:i+1})));
  const corpus = [
    {id:'d1',sourceRecordId:'native-1',caseNumber:'CIV 101/2020',court:'Juzgado Civil 1',courtNumber:'1',decisionDate:'2021-01-01',fileId:'f1'},
    {id:'d2',caseNumber:'CIV 102/2020',court:'Juzgado Civil 2',courtNumber:'2',decisionDate:'2021-02-02',fileId:'f2'},
    {id:'d3',caseNumber:'CIV 103/2020',court:'Juzgado Civil 3',courtNumber:'3',decisionDate:null},
    {id:'d4',caseNumber:'CIV 104/2020',court:'Juzgado Civil 4',courtNumber:'4',decisionDate:'2021-04-05'},
  ];
  const a = reconcile(intake.snapshot, corpus), b = reconcile(intake.snapshot, corpus);
  assert.deepEqual(a, b);
  assert.deepEqual(Object.fromEntries(a.rows.map(x=>[x.sourceRecordId,x.matchLevel])), {
    'native-1':'EXACT','high-source':'HIGH','medium-source':'MEDIUM','conflict-source':'CONFLICT','gap-source':'UNMATCHED' });
  assert.equal(a.funnel.censusTotal, 5);
  assert.equal(a.funnel.matchedInGalilei, 2);
  assert.equal(a.funnel.review, 2);
  assert.equal(a.funnel.unmatched, 1);
});

test('acquisition manifest contains only in-scope unmatched rows and performs no network work', () => {
  const input = [valid('direct','1/2020',1,'2020-01-02',{document_url:'https://example.invalid/a.pdf',document_url_type:'DIRECT_PDF'}),
    valid('viewer','2/2020',2,'2020-01-02',{document_url:'https://example.invalid/view/2',document_url_type:'VIEWER'}),
    valid('meta','3/2020',3,'2020-01-02',{url_metadata:'https://example.invalid/metadata/3'}),
    {...valid('chamber','4/2020',4,'2020-01-02'),organo:'Cámara Nacional de Apelaciones en lo Civil'}];
  const intake = normalizeRows(input.map((row,i)=>({row,rowNumber:i+2})));
  const rec = reconcile(intake.snapshot, []);
  const manifest = makeAcquisitionManifest(rec, intake.snapshot);
  assert.deepEqual(manifest.candidates.map(x=>x.priority), ['P0','P1','P2']);
  assert.equal(manifest.networkRequests, 0);
  assert.equal(manifest.downloads, 0);
});

test('normalization hashes are idempotent and supplied completeness is never inferred', () => {
  const rows = [{row:valid('same','10/2020',10,'2020-02-03'),rowNumber:2}];
  const a = normalizeRows(rows), b = normalizeRows(rows);
  assert.equal(a.normalizedSha256, b.normalizedSha256);
  assert.equal(a.snapshot.censusCompleteness, 'UNKNOWN');
  assert.equal(normalizeRows(rows,{completeness:'DECLARED_COMPLETE'}).snapshot.censusCompleteness, 'DECLARED_COMPLETE');
});

test('one-command intake emits a read-only traceable run with errors, hashes and acquisition outputs', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bjc-intake-cli-'));
  try {
    const inputPath = path.join(temp, 'received.csv');
    const outRoot = path.join(temp, 'runs');
    const corpusPath = path.join(temp, 'corpus.json');
    const content = 'source_record_id,fuero,organo,expediente,expediente_anio,fecha_decision,url_documento\ncli-1,Civil,Juzgado Civil 1,CIV 1/2020,2020,2021-01-01,https://example.invalid/view/1\ncli-2,Civil,Cámara Nacional de Apelaciones en lo Civil,2/2020,2020,2021-01-02,\n';
    fs.writeFileSync(inputPath, content, 'utf8');
    fs.writeFileSync(corpusPath, JSON.stringify({id:'cli-doc',sourceRecordId:'cli-1',caseNumber:'CIV 1/2020',court:'Juzgado Civil 1',courtNumber:'1',decisionDate:'2021-01-01',fileId:'cli-file'}));
    const before = require('./intake.cjs').sha256(fs.readFileSync(inputPath));
    const stdout = execFileSync(process.execPath, [path.join(__dirname,'intake.cjs'),'--input',inputPath,'--source','CLI_FIXTURE','--corpus',corpusPath,'--output-root',outRoot,'--git-sha','test-sha'],{encoding:'utf8'});
    const runName = fs.readdirSync(outRoot)[0], runDir = path.join(outRoot,runName);
    const summary = JSON.parse(fs.readFileSync(path.join(runDir,'final-summary.json'),'utf8'));
    const manifest = JSON.parse(fs.readFileSync(path.join(runDir,'intake-manifest.json'),'utf8'));
    assert.equal(summary.rows,2);
    assert.equal(summary.inScope,1);
    assert.equal(summary.matched,1);
    assert.equal(summary.unmatched,0);
    assert.equal(manifest.sourceHash,before);
    assert.equal(manifest.gitSha,'test-sha');
    assert.equal(manifest.networkRequests,0);
    assert.equal(manifest.databaseWrites,0);
    assert.equal(manifest.sourceFileModified,false);
    assert.equal(require('./intake.cjs').sha256(fs.readFileSync(inputPath)),before);
    assert.ok(fs.existsSync(path.join(runDir,'errors.csv')));
    assert.ok(fs.existsSync(path.join(runDir,'normalized-census.json')));
    assert.equal(JSON.parse(stdout).inputSha256,before);
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
});

test('synthetic 100 row export, current first-instance local target smoke, and 10k performance', () => {
  const rows = Array.from({length:100},(_,i)=>valid(`sim-${String(i+1).padStart(3,'0')}`,`${5000+i}/2020`,(i%64)+1,'2021-05-06'));
  const synthetic = normalizeRows(rows.map((row,i)=>({row,rowNumber:i+2})),{source:'SIMULATED_NOT_REAL'});
  assert.equal(synthetic.summary.rows,100);
  assert.equal(synthetic.snapshot.source,'SIMULATED_NOT_REAL');
  const localCorpus = [{id:'cmv0mgelq0001ts8v47ts9lsr',sourceRecordId:'TFN_ACTUAL:dfe01db5-ca63-4cf0-8193-6dbb5fbb6a0f',
    caseNumber:'CIV 072119/2022',court:'JUZGADO CIVIL 64 - SECRETARIA Nº 94',courtNumber:'64',instance:'FIRST_INSTANCE',decisionDate:'2026-10-08T03:00:00.000Z',sha256:'39ed9ea0de1965a20e0db27577045cdb70893b04fb3c49baf802bf59049c70c7'}];
  const local = valid('TFN_ACTUAL:dfe01db5-ca63-4cf0-8193-6dbb5fbb6a0f','072119/2022',64,'2026-10-08');
  const localResult = reconcile(normalizeRows([{row:local,rowNumber:2}]).snapshot,localCorpus);
  assert.equal(localResult.rows[0].matchLevel,'EXACT');
  assert.equal(localResult.rows[0].corpusDocumentId,'cmv0mgelq0001ts8v47ts9lsr');
  fs.writeFileSync(path.resolve(__dirname,'../../../../_recovery-work/jurisprudencia-j3/local-first-instance-smoke.json'),`${JSON.stringify({target:'single local DEV FIRST_INSTANCE, read-only',match:localResult.rows[0],databaseWrites:0},null,2)}\n`);
  const perf = [100,1000,10000].map(count=>{
    const rows=Array.from({length:count},(_,i)=>valid(`perf-${String(i).padStart(5,'0')}`,`${100000+i}/2020`,(i%64)+1,'2022-03-04'));
    const corpus=rows.map((row,i)=>({id:`perf-doc-${i}`,sourceRecordId:row.source_record_id,caseNumber:row.expediente,court:row.organo,courtNumber:row.juzgado_numero,decisionDate:row.fecha_decision,fileId:`perf-file-${i}`}));
    return statsOnly(rows,{corpus});
  });
  assert.deepEqual(perf.map(x=>x.rows),[100,1000,10000]);
  assert.ok(perf.every(x=>x.matched===x.rows && x.corpusRows===x.rows));
  assert.ok(perf.every(x=>Number.isFinite(x.elapsedMs) && x.elapsedMs>=0));
  const out=path.resolve(__dirname,'../../../../_recovery-work/jurisprudencia-j3');
  fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'performance.json'),`${JSON.stringify(perf,null,2)}\n`);
  const syntheticExportPath=path.join(out,'synthetic-authorized-export.json');
  fs.writeFileSync(syntheticExportPath,`${JSON.stringify(rows,null,2)}\n`);
  execFileSync(process.execPath,[path.join(__dirname,'intake.cjs'),'--input',syntheticExportPath,'--source','SIMULATED_NOT_REAL','--output-root',path.join(out,'simulated-run'),'--git-sha','SIMULATED'],{stdio:'ignore'});
});

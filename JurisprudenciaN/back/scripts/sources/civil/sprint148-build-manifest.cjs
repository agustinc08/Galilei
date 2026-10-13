'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PDFParse } = require('pdf-parse');
const ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const WORK = path.join(ROOT, '_recovery-work', 'sprint148');
const VIEWER = path.join(ROOT, '_recovery-work', 'sprint146', 'viewer', 'viewer-recovery.sqlite');
const QUANT = path.join(ROOT, '_recovery-work', 'sprint144', 'quantification', 'checkpoint.sqlite');
const CORPUS_MATCHES = path.join(ROOT, '_recovery-work', 'sprint144', 'quantification', 'crossmatches.json');
const DBPATH = path.join(WORK, 'manifest.sqlite');
fs.mkdirSync(WORK, { recursive: true });
const db = new DatabaseSync(DBPATH);
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS objects(sha256 TEXT PRIMARY KEY, local_path TEXT NOT NULL, bytes INTEGER, actual_sha256 TEXT, pdf_valid INTEGER, page_count INTEGER, parser_error TEXT, validated_at TEXT);
CREATE TABLE IF NOT EXISTS source_records(source_key TEXT PRIMARY KEY, quantification_id TEXT, external_id TEXT, detail_url TEXT, viewer_url TEXT, document_url TEXT, case_number TEXT, normalized_case_number TEXT, title TEXT, chamber TEXT, court TEXT, decision_date TEXT, year INTEGER, local_path TEXT, bytes INTEGER, mime TEXT, sha256 TEXT, pdf_valid INTEGER, page_count INTEGER, corpus_match_status TEXT, corpus_document_id TEXT, ingest_status TEXT, extraction_status TEXT, search_status TEXT, identity_status TEXT, duplicate_group_size INTEGER, notes TEXT);`);
const viewerDb = new DatabaseSync(VIEWER, { readOnly: true });
const quantDb = new DatabaseSync(QUANT, { readOnly: true });
const viewer = viewerDb.prepare("SELECT * FROM results WHERE classification='PDF_ACCESSIBLE' ORDER BY year, chamber, source_key").all();
const quant = quantDb.prepare('SELECT source_key,case_record_id,case_number,title,decision_date,chamber,first_instance_court,detail_url FROM records').all();
const quantByKey = new Map(quant.map(r => [r.source_key, r]));
const oldMatches = JSON.parse(fs.readFileSync(CORPUS_MATCHES, 'utf8')).matches;
const matchByKey = new Map(oldMatches.map(r => [r.sourceKey, r]));
const objectRows = new Map();
for (const row of viewer) { if (!objectRows.has(row.pdf_sha256)) objectRows.set(row.pdf_sha256, []); objectRows.get(row.pdf_sha256).push(row); }
const normDocket = value => { const raw=String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase(); const m=raw.match(/(\d+)\s*[/\-]\s*(\d{2,4})/); if(!m)return raw.replace(/[^A-Z0-9]/g,'')||null; const num=m[1].replace(/^0+(?=\d)/,''); const year=m[2].length===2?m[2]:m[2].replace(/^0+(?=\d)/,''); return `${num}/${year}`; };
const normRoom = value => String(value||'').match(/(?:SALA\s*)?([A-M])\b/i)?.[1]?.toUpperCase()||null;
const legalIdentity = row => {
  const q = quantByKey.get(row.source_key) || {};
  const caseNo = row.case_number || q.case_number;
  const room = row.chamber || q.chamber;
  const date = row.decision_date || q.decision_date;
  return normDocket(caseNo) && normRoom(room) && date ? `${normDocket(caseNo)}|${normRoom(room)}|${date}` : null;
};
const identityHashes = new Map();
for (const row of viewer) {
  const identity = legalIdentity(row);
  if (!identity) continue;
  if (!identityHashes.has(identity)) identityHashes.set(identity, new Set());
  identityHashes.get(identity).add(row.pdf_sha256);
}
const existingObj=db.prepare('SELECT * FROM objects WHERE sha256=?');
const insertObj=db.prepare(`INSERT INTO objects(sha256,local_path,bytes,actual_sha256,pdf_valid,page_count,parser_error,validated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(sha256) DO UPDATE SET local_path=excluded.local_path,bytes=excluded.bytes,actual_sha256=excluded.actual_sha256,pdf_valid=excluded.pdf_valid,page_count=excluded.page_count,parser_error=excluded.parser_error,validated_at=excluded.validated_at`);
(async()=>{
 let processed=0;
 for(const [sha,hashRows] of objectRows){
   const prior=existingObj.get(sha); if(prior&&prior.pdf_valid!==null){processed++;continue;}
   const file=hashRows[0].file_path||path.join(ROOT,'_recovery-work','sprint146','viewer','objects',`${sha}.pdf`);
   let bytes=0,actual=null,valid=false,pages=0,error=null;
   try{const st=fs.statSync(file);bytes=st.size;if(!st.isFile()||bytes<=0)throw new Error('MISSING_OR_EMPTY');const data=fs.readFileSync(file);if(data.subarray(0,5).toString('ascii')!=='%PDF-')throw new Error('PDF_SIGNATURE_INVALID');actual=crypto.createHash('sha256').update(data).digest('hex');if(actual!==sha)throw new Error('SHA256_MISMATCH');const parser=new PDFParse({data});try{const info=await parser.getInfo({parsePageInfo:true});pages=Number(info.total||info.pages?.length||0);if(!Number.isInteger(pages)||pages<=0)throw new Error('PDF_ZERO_PAGES');valid=true;}finally{await parser.destroy();}}
   catch(e){error=String(e?.message||e).slice(0,1000);}
   insertObj.run(sha,file,bytes,actual,valid?1:0,pages,error,new Date().toISOString());processed++;if(processed%50===0){db.exec('PRAGMA wal_checkpoint(PASSIVE)');console.log(`PDF_AUDIT ${processed}/${objectRows.size}`);}
 }
 const updateRecord=db.prepare(`INSERT INTO source_records(source_key,quantification_id,external_id,detail_url,viewer_url,document_url,case_number,normalized_case_number,title,chamber,court,decision_date,year,local_path,bytes,mime,sha256,pdf_valid,page_count,corpus_match_status,corpus_document_id,ingest_status,extraction_status,search_status,identity_status,duplicate_group_size,notes) VALUES(${new Array(27).fill('?').join(',')}) ON CONFLICT(source_key) DO UPDATE SET quantification_id=excluded.quantification_id,external_id=excluded.external_id,detail_url=excluded.detail_url,viewer_url=excluded.viewer_url,document_url=excluded.document_url,case_number=excluded.case_number,normalized_case_number=excluded.normalized_case_number,title=excluded.title,chamber=excluded.chamber,court=excluded.court,decision_date=excluded.decision_date,year=excluded.year,local_path=excluded.local_path,bytes=excluded.bytes,mime=excluded.mime,sha256=excluded.sha256,pdf_valid=excluded.pdf_valid,page_count=excluded.page_count,corpus_match_status=excluded.corpus_match_status,corpus_document_id=excluded.corpus_document_id,ingest_status=excluded.ingest_status,extraction_status=excluded.extraction_status,search_status=excluded.search_status,identity_status=excluded.identity_status,duplicate_group_size=excluded.duplicate_group_size,notes=excluded.notes`);
 db.exec('BEGIN');
 for(const row of viewer){
   const hashRows=objectRows.get(row.pdf_sha256)||[row]; const q=quantByKey.get(row.source_key)||{}; const match=matchByKey.get(row.source_key); const sha=String(row.pdf_sha256||''); const obj=existingObj.get(sha);
   const caseNo=row.case_number||q.case_number||null; const chamber=row.chamber||q.chamber||null; const decisionDate=row.decision_date||q.decision_date||null;
   const externalId=`CUANTIFICACION:${crypto.createHash('sha256').update(row.source_key).digest('hex')}`;
   const corpusStatus=match?.corpus?.status||'UNRESOLVED'; const corpusId=match?.corpus?.matches?.find(m=>['EXACT','HIGH_CONFIDENCE'].includes(m.status))?.documentId||null;
   const quantConflict=Boolean(q.source_key&&((row.case_number&&q.case_number&&normDocket(row.case_number)!==normDocket(q.case_number))||(row.chamber&&q.chamber&&normRoom(row.chamber)!==normRoom(q.chamber))||(row.decision_date&&q.decision_date&&row.decision_date!==q.decision_date)));
   const identity=legalIdentity(row);
   const legalGroup=hashRows.map(x=>{const q2=quantByKey.get(x.source_key)||{};return `${normDocket(x.case_number||q2.case_number)}|${normRoom(x.chamber||q2.chamber)}|${x.decision_date||q2.decision_date}`;});
   const shaConflict=new Set(legalGroup).size>1;
   let identityStatus='INSUFFICIENT_METADATA',notes=[];
   if(!obj?.pdf_valid)identityStatus='INVALID_FILE';
   else if(quantConflict||shaConflict){identityStatus='CONFLICT';notes.push(quantConflict?'VIEWER_QUANT_METADATA_MISMATCH':'SHA_LINKS_MULTIPLE_LEGAL_IDENTITIES');}
   else if(corpusStatus==='EXACT')identityStatus='EXACT_DOCUMENT_MATCH'; else if(identity && (identityHashes.get(identity)?.size || 0) > 1){identityStatus='SAME_DOCUMENT_DIFFERENT_FILE';notes.push('EXACT_DOCKET_ROOM_DATE_MULTIPLE_HASHES');} else if(corpusStatus==='HIGH_CONFIDENCE')identityStatus='HIGH_CONFIDENCE'; else if(corpusStatus==='CANDIDATE')identityStatus='CANDIDATE'; else if(identity)identityStatus='NEW_DOCUMENT';
   const ingestStatus=identityStatus==='NEW_DOCUMENT'?'READY_NEW':identityStatus==='EXACT_DOCUMENT_MATCH'?'READY_LINK_EXISTING':identityStatus==='INVALID_FILE'?'INVALID':'REVIEW_REQUIRED';
   notes.push(q.source_key?'QUANTIFICATION_CHECKPOINT':'VIEWER_CHECKPOINT_ONLY');
   updateRecord.run(row.source_key,q.case_record_id||null,externalId,q.detail_url||row.detail_url||null,row.viewer_final_url||null,null,caseNo,normDocket(caseNo),row.title||q.title||null,chamber,'Cámara Nacional de Apelaciones en lo Civil',decisionDate,row.year||Number(String(decisionDate||'').slice(0,4))||null,row.file_path||null,obj?.bytes||row.download_bytes||0,row.mime_type||'application/pdf',sha,obj?.pdf_valid??null,obj?.page_count||0,corpusStatus,corpusId,ingestStatus,obj?.pdf_valid?'TEXT_PENDING':'INVALID',corpusId?'PENDING':'NOT_PROJECTED',identityStatus,hashRows.length,notes.join(';'));
 }
 db.exec('COMMIT');
 const counts=db.prepare('SELECT identity_status,count(*) n FROM source_records GROUP BY identity_status ORDER BY identity_status').all();
 const objCounts=db.prepare('SELECT pdf_valid,count(*) n,sum(bytes) bytes,sum(page_count) pages FROM objects GROUP BY pdf_valid').all();
 const objectDir=path.join(ROOT,'_recovery-work','sprint146','viewer','objects');
 const pdfNames=fs.readdirSync(objectDir).filter(name=>name.toLowerCase().endsWith('.pdf'));
 const missingSourceFiles=viewer.filter(row=>!row.file_path||!fs.existsSync(row.file_path)).length;
 const summary={generatedAt:new Date().toISOString(),sourceRecords:viewer.length,quantificationKeyMatches:viewer.filter(r=>quantByKey.has(r.source_key)).length,objects:objectRows.size,physicalPdfObjects:pdfNames.length,missingSourceFiles,unexpectedPdfObjects:pdfNames.filter(name=>!objectRows.has(name.slice(0,-4).toLowerCase())).length,sourcePhysicalBytes:viewer.reduce((s,r)=>s+Number(r.download_bytes||0),0),objectPhysicalBytes:db.prepare('SELECT sum(bytes) n FROM objects').get().n,distinctPdfValidation:objCounts,shaDuplicates:viewer.length-objectRows.size,maxSourceRowsPerSha:Math.max(...[...objectRows.values()].map(x=>x.length)),sameLegalIdentityDifferentFileGroups:[...identityHashes.values()].filter(h=>h.size>1).length,byIdentityStatus:counts,sourceMetadataMismatches:viewer.filter(r=>{const q=quantByKey.get(r.source_key);return q&&((r.case_number&&q.case_number&&normDocket(r.case_number)!==normDocket(q.case_number))||(r.chamber&&q.chamber&&normRoom(r.chamber)!==normRoom(q.chamber))||(r.decision_date&&q.decision_date&&r.decision_date!==q.decision_date))}).length};
 fs.writeFileSync(path.join(WORK,'audit-summary.json'),JSON.stringify(summary,null,2)+'\n');
 const manifestRows=db.prepare('SELECT * FROM source_records ORDER BY year, normalized_case_number, chamber, decision_date, sha256').all();
 fs.writeFileSync(path.join(WORK,'manifest.jsonl'),manifestRows.map(row=>JSON.stringify(row)).join('\n')+'\n');
 const byStatus=new Map(); for(const row of manifestRows){if(!byStatus.has(row.identity_status))byStatus.set(row.identity_status,[]);byStatus.get(row.identity_status).push(row);}
 const safeSample=row=>({year:row.year,caseNumber:row.case_number,normalizedCaseNumber:row.normalized_case_number,title:row.title,chamber:row.chamber,decisionDate:row.decision_date,sha256:row.sha256,bytes:row.bytes,pageCount:row.page_count,status:row.identity_status,notes:row.notes});
 const shaSeen=new Set(); const dupRows=manifestRows.filter(row=>{if(row.duplicate_group_size<2||row.identity_status!=='NEW_DOCUMENT')return false;if(shaSeen.has(row.sha256))return true;shaSeen.add(row.sha256);return false;});
 const sameFileGroups=new Map(); for(const row of manifestRows)if(row.identity_status==='SAME_DOCUMENT_DIFFERENT_FILE'){const key=`${row.normalized_case_number}|${row.chamber}|${row.decision_date}`;if(!sameFileGroups.has(key))sameFileGroups.set(key,[]);sameFileGroups.get(key).push(row);}
 const samples={newDocuments:(byStatus.get('NEW_DOCUMENT')||[]).slice(0,20).map(safeSample),duplicateFiles:dupRows.slice(0,20).map(safeSample),sameDocumentDifferentFile:[...sameFileGroups.values()].slice(0,20).flatMap(rows=>rows.slice(0,2)).slice(0,20).map(safeSample),conflicts:(byStatus.get('CONFLICT')||[]).map(safeSample),insufficientMetadata:(byStatus.get('INSUFFICIENT_METADATA')||[]).map(safeSample),invalid:(byStatus.get('INVALID_FILE')||[]).map(safeSample)};
 fs.writeFileSync(path.join(WORK,'quality-samples.json'),JSON.stringify(samples,null,2)+'\n');
 console.log(JSON.stringify(summary,null,2));viewerDb.close();quantDb.close();db.close();
})().catch(e=>{try{db.exec('ROLLBACK')}catch{};console.error(e.stack||e);process.exitCode=1;});

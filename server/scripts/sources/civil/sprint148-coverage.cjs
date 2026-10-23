const fs=require('fs'); const {DatabaseSync}=require('node:sqlite'); const root='C:/proyecto triple';
const q=new DatabaseSync(root+'/_recovery-work/sprint144/quantification/checkpoint.sqlite',{readOnly:true});
const v=new DatabaseSync(root+'/_recovery-work/sprint146/viewer/viewer-recovery.sqlite',{readOnly:true});
const m=new DatabaseSync(root+'/_recovery-work/sprint148/manifest.sqlite',{readOnly:true});
const corpus=JSON.parse(fs.readFileSync(root+'/_recovery-work/sprint147/corpus-snapshot.json','utf8'));
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\b(?:EXPTE?|EXPEDIENTE|CIV|NRO|Nº|NO)\b/g,'').replace(/[^A-Z0-9]/g,'');
const unique=(rows,key)=>new Set(rows.map(key).filter(Boolean)).size;
const out=[];
for(let year=1993;year<=2026;year++){
 const known=q.prepare('select source_key,case_number,case_record_id,decision_date from records where substr(decision_date,1,4)=?').all(String(year));
 const files=m.prepare('select * from source_records where year=?').all(year);
 const docs=corpus.filter(d=>String(d.decisionDate||'').slice(0,4)===String(year));
 const confirmed=files.filter(r=>['EXACT_DOCUMENT_MATCH'].includes(r.identity_status));
 out.push({year,knownCases:unique(known,r=>norm(r.case_number)||r.case_record_id||r.source_key),pdfLinks:files.length,validPdfLinks:files.filter(r=>r.pdf_valid===1).length,uniqueValidPdfSha:new Set(files.filter(r=>r.pdf_valid===1).map(r=>r.sha256)).size,existingCorpusDocuments:docs.length,preExistingStrongCorpusMatches:confirmed.length,pendingKnownCases:null});
}
const file=root+'/_recovery-work/sprint148/coverage-by-year.json'; fs.writeFileSync(file,JSON.stringify({generatedAt:new Date().toISOString(),source:'local quantification checkpoint + viewer manifest + Sprint147 Corpus snapshot; pre-ingestion',years:out},null,2)+'\n');
console.log(JSON.stringify({output:file,years:out.length,knownCases:q.prepare('select count(*) n from records').get().n,manifestRecords:m.prepare('select count(*) n from source_records').get().n,existingCivilCorpus:corpus.length},null,2));q.close();v.close();m.close();

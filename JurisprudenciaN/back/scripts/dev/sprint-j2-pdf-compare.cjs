'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { PDFParse } = require('pdf-parse');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const OUT = path.join(ROOT, '_recovery-work', 'jurisprudencia-j2');
const J1 = path.join(ROOT, '_recovery-work', 'jurisprudencia-j1');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const write = (n,v) => fs.writeFileSync(path.join(OUT,n), `${JSON.stringify(v,null,2)}\n`);
const sha = text => createHash('sha256').update(text).digest('hex');
const norm = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/gu,'').toUpperCase().replace(/[^A-Z0-9]+/gu,' ').trim().replace(/\s+/gu,' ');
const storageRoot = path.join(ROOT, '_dev-corpus-storage');

async function extract(file) {
  if (!file || !fs.existsSync(file)) return { available: false, file };
  const bytes = fs.readFileSync(file);
  if (bytes.subarray(0,5).toString('ascii') !== '%PDF-') return { available: true, validSignature: false, bytes: bytes.length, file };
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    const text = result.text || '';
    const upper = text.toUpperCase();
    const lineSet = [...new Set(upper.split(/\r?\n/u).map(x=>x.replace(/\s+/gu,' ').trim()).filter(x=>x.length>=24))];
    const signatures = lineSet.filter(x=>/FIRMADO POR|JUEZ|JUEZA|JUEZ DE CAMARA|SECRETARIO|SECRETARIA/u.test(x)).slice(-10);
    const documentStamps = [...new Set((text.match(/#\d{6,}#\d{6,}#\d{8,}/gu) || []))].slice(0, 5);
    const markers = ['Y VISTOS','SE RESUELVE','RESUELVE:','POR ELLO','FALLA:','RESUELVO'].filter(x=>upper.includes(x));
    const disposition = upper.slice(-9000).match(/(?:Y VISTOS|SE RESUELVE|RESUELVE:|POR ELLO|FALLA:|RESUELVO)[\s\S]{0,1800}/u)?.[0] || '';
    const ntext = norm(text);
    return { available: true, validSignature: true, file, bytes: bytes.length, sha256: sha(bytes), pages: Array.isArray(result.pages) ? result.pages.length : result.pages,
      chars: text.length, normalizedTextSha256: sha(ntext), normalizedChars: ntext.length,
      headingLines: lineSet.slice(0,8), signatures, documentStamps, dispositionMarkers: markers,
      dispositionNormalized: norm(disposition).slice(0,3000), text };
  } finally { await parser.destroy(); }
}
function compare(left,right,legalIdentityExact) {
  if (!left.available || !right.available || !left.validSignature || !right.validSignature) return { classification:'INCONCLUSIVE', reason:'PDF_MISSING_OR_INVALID' };
  const A = new Set(norm(left.text).split(' ').filter(x=>x.length>3));
  const B = new Set(norm(right.text).split(' ').filter(x=>x.length>3));
  let both=0; for(const token of A) if(B.has(token)) both++;
  const jaccard = A.size || B.size ? both / new Set([...A,...B]).size : 0;
  const DA=new Set(norm(left.dispositionNormalized).split(' ').filter(x=>x.length>2));
  const DB=new Set(norm(right.dispositionNormalized).split(' ').filter(x=>x.length>2));
  let dispositionCommon=0; for(const token of DA) if(DB.has(token)) dispositionCommon++;
  const dispositionJaccard=DA.size||DB.size?dispositionCommon/new Set([...DA,...DB]).size:0;
  const sameSignatures = left.signatures.length > 0 && left.signatures.some(x=>right.signatures.includes(x));
  const sameDocumentStamp = left.documentStamps.length > 0 && left.documentStamps.some(x=>right.documentStamps.includes(x));
  const sameMarker = left.dispositionMarkers.some(x=>right.dispositionMarkers.includes(x));
  const sameDisposition = left.dispositionNormalized.length > 0 && right.dispositionNormalized.length > 0 && dispositionJaccard >= 0.85;
  const exactText = left.normalizedTextSha256 === right.normalizedTextSha256;
  const classification = exactText && legalIdentityExact ? 'SAME_DECISION_EQUIVALENT_RENDER'
    : legalIdentityExact && sameSignatures && ((sameMarker && sameDisposition) || (sameDocumentStamp && sameMarker)) ? 'SAME_DECISION_DIFFERENT_VERSION'
      : 'INCONCLUSIVE';
  return { classification, legalIdentityExact, normalizedTextExact:exactText, tokenJaccard:Number(jaccard.toFixed(4)),
    pages:{left:left.pages,right:right.pages}, bytes:{left:left.bytes,right:right.bytes},
    sameDisposition, dispositionJaccard:Number(dispositionJaccard.toFixed(4)), sameSignatures, sameMarker, sameDocumentStamp,
    documentStampEvidence:{left:left.documentStamps,right:right.documentStamps}, dispositionMarkers:{left:left.dispositionMarkers,right:right.dispositionMarkers},
    signatureEvidence:{left:left.signatures,right:right.signatures}, headingEvidence:{left:left.headingLines,right:right.headingLines},
    leftTextSha256:left.normalizedTextSha256,rightTextSha256:right.normalizedTextSha256 };
}
function metaExact(a,b) {
  return String(a.caseNumber||a.case_number||'').toUpperCase()===String(b.caseNumber||b.case_number||'').toUpperCase() &&
    String(a.chamber||'').toUpperCase().replace(/^SALA\s*/u,'')===String(b.chamber||'').toUpperCase().replace(/^SALA\s*/u,'') &&
    String(a.court||'').normalize('NFD').replace(/[\u0300-\u036f]/gu,'').toUpperCase()===String(b.court||'').normalize('NFD').replace(/[\u0300-\u036f]/gu,'').toUpperCase() &&
    String(a.decisionDate||a.decision_date||'').slice(0,10)===String(b.decisionDate||b.decision_date||'').slice(0,10);
}
async function main() {
  const groups = read(path.join(J1,'review-input.json')).groups;
  const exact = read(path.join(J1,'review-classification.json')).groups.filter(x=>x.status==='EXACT_DOCUMENT_MATCH');
  const audit = read(path.join(OUT,'first-instance-current.json'));
  const results=[];
  for(const group of exact) {
    const source=group.sourceEvidence[0];
    const corpus=audit.targetLegalIdentityCandidates.find(x=>x.id===source.corpus_document_id);
    const corpusPath=corpus?.storageKey ? path.join(storageRoot,...corpus.storageKey.split(/[\\/]/u)) : null;
    const [a,b]=await Promise.all([extract(source.local_path),extract(corpusPath)]);
    const cmp=compare(a,b,metaExact(source,corpus||{}));
    results.push({legalDocumentKey:group.legalDocumentKey,title:{source:source.title,corpus:corpus?.title},
      legalMetadata:{source:{caseNumber:source.case_number,court:source.court,chamber:source.chamber,decisionDate:source.decision_date},
        corpus:{caseNumber:corpus?.caseNumber,court:corpus?.court,chamber:corpus?.chamber,decisionDate:corpus?.decisionDate}},
      fileIdentity:{sourceSha:source.sha256,corpusSha:corpus?.sha256,shaEqual:source.sha256===corpus?.sha256,
        sourceMime:source.mime,sourceBytes:a.bytes,sourceSignature:a.validSignature,corpusMime:corpus?.mimeType,corpusBytes:b.bytes,corpusSignature:b.validSignature,
        sourcePath:source.local_path,corpusStorageKey:corpus?.storageKey},
      compare:cmp, recommendation:cmp.classification==='SAME_DECISION_EQUIVALENT_RENDER'
        ? 'A manually approved multi-file association is supportable; no write was performed.'
        : 'Keep separate and request human review; no write was performed.'});
  }
  const variants=[];
  for(const group of groups.filter(x=>x.status==='SAME_DOCUMENT_DIFFERENT_FILE')) {
    const unique=[...new Map((group.sourceEvidence||[]).filter(x=>x.sha256).map(x=>[x.sha256,x])).values()];
    const pdfs=await Promise.all(unique.map(x=>extract(x.local_path)));
    const pairs=[];
    for(let i=0;i<unique.length;i++) for(let j=i+1;j<unique.length;j++) {
      const cmp=compare(pdfs[i],pdfs[j],metaExact(unique[i],unique[j]));
      pairs.push({leftSha:unique[i].sha256,rightSha:unique[j].sha256,compare:cmp});
    }
    variants.push({legalDocumentKey:group.legalDocumentKey,caseNumber:group.caseNumber,court:group.court,chamber:group.chamber,
      decisionDate:group.decisionDate,sourceRecords:group.sourceRecords,distinctFiles:unique.map((x,i)=>({sha256:x.sha256,bytes:x.bytes,
        sourcePath:x.local_path,pages:pdfs[i].pages,validPdf:pdfs[i].validSignature,textChars:pdfs[i].chars,
        normalizedTextSha256:pdfs[i].normalizedTextSha256,headingEvidence:pdfs[i].headingLines,signatureEvidence:pdfs[i].signatures,
        dispositionMarkers:pdfs[i].dispositionMarkers})),pairs});
  }
  const allPairs=variants.flatMap(x=>x.pairs);
  const counts={totalGroups:variants.length,equivalentRender:variants.filter(x=>x.pairs.some(p=>p.compare.classification==='SAME_DECISION_EQUIVALENT_RENDER')).length,
    differentVersion:variants.filter(x=>x.pairs.some(p=>p.compare.classification==='SAME_DECISION_DIFFERENT_VERSION')).length,
    related:0,different:0,inconclusive:variants.filter(x=>x.pairs.every(p=>p.compare.classification==='INCONCLUSIVE')).length,
    pairComparisons:allPairs.length};
  write('same-decision-analysis.json',{status:'COMPLETE_LOCAL_READ_ONLY',method:'Extracted local PDF text with pdf-parse; compared page count, byte/SHA, normalized-text hash, header lines, disposition clauses, signature lines and token overlap. Numeric similarity alone never assigns same-decision.',
    twoHighLegalIdentityDifferentSha:results,sameIdentityDifferentFile:{total:variants.length,counts,groups:variants}});
  const blockerFile=path.join(OUT,'review-blockers.json');
  const blockers=read(blockerFile);
  const evidence=new Map();
  for(const group of variants) evidence.set(group.legalDocumentKey,group.pairs.map(p=>`${p.compare.classification};tokens=${p.compare.tokenJaccard};disposition=${p.compare.dispositionJaccard};sameSignatures=${p.compare.sameSignatures}`).join(' | ') || 'No pair available');
  for(const pair of results) evidence.set(pair.legalDocumentKey,`${pair.compare.classification};pages=${pair.compare.pages.left}/${pair.compare.pages.right};tokens=${pair.compare.tokenJaccard};disposition=${pair.compare.dispositionJaccard};sameSignatures=${pair.compare.sameSignatures};samePrintedStamp=${pair.compare.sameDocumentStamp}`);
  for(const row of blockers.groups) if(evidence.has(row.groupId)) row.textSimilarityEvidence=evidence.get(row.groupId);
  write('review-blockers.json',blockers);
  const headers=['groupId','blockerCategory','priority','confidence','caseNumber','expedienteYear','year','court','chamber','decisionDate','sourceRecordId','candidateDocumentId','sourceSha','textSimilarityEvidence','recommendedAction','reviewNotes'];
  const cell=value=>{const s=String(value??'');return /[",\r\n]/u.test(s)?`"${s.replace(/"/gu,'""')}"`:s;};
  fs.writeFileSync(path.join(OUT,'human-review-v2.csv'),[headers.join(','),...blockers.groups.map(x=>headers.map(h=>cell(h==='sourceRecordId'?x.sourceRecordIds.join('|'):h==='candidateDocumentId'?x.candidateDocumentIds.join('|'):h==='sourceSha'?x.sourceSha.join('|'):h==='recommendedAction'?x.recommendation:x[h])).join(','))].join('\r\n')+'\r\n');
  const summary=read(path.join(OUT,'final-summary.json'));
  summary.sameDecisionAnalysis={status:'COMPLETE_LOCAL_READ_ONLY',twoPairs:results.length,classificationCounts:results.reduce((a,x)=>(a[x.compare.classification]=(a[x.compare.classification]||0)+1,a),{}),
    fifteenGroupClassificationCounts:counts,allSourcePdfsPresent:variants.every(x=>x.distinctFiles.every(f=>f.validPdf))};
  write('final-summary.json',summary);
  console.log(JSON.stringify(summary.sameDecisionAnalysis,null,2));
}
main().catch(error=>{console.error(`J2_PDF_COMPARE_FAILED: ${error.stack||error.message}`);process.exitCode=1;});

'use strict';

const crypto = require('node:crypto');
const VALID_SALAS = new Set('ABCDEFGHIJKLM'.split(''));
const DECISIONS = Object.freeze(['CONFIRM_PROPOSAL','SET_OTHER_SALA','NO_SALA_EVIDENCE','AMBIGUOUS','NOT_APPLICABLE','SKIP']);
const VERSION = 'j713-review-v1';
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
function caseEvidenceHash(item) { return hash({ documentId:item.documentId, fileSha:item.fileSha, proposal:item.machineProposalSala, classification:item.machineClassification, evidence:item.evidence }); }
function priorityFor(item) {
  const own = item.evidence.filter(e => e.selfReference && ['HEADER_SELF','TRIBUNAL_SELF','SIGNATURE_SELF','TITLE'].includes(e.type));
  const distinctKinds = new Set(own.map(e => e.type)).size;
  const distinctPages = new Set(own.map(e => e.page).filter(Number.isFinite)).size;
  const corroborated = distinctKinds > 1 || distinctPages > 1;
  if (item.legalKeyImpact.completesLegalKey && corroborated) return 'P0';
  if (own.some(e => e.type === 'HEADER_SELF' && (e.page === 1 || e.position === 'FIRST_5_PERCENT'))) return 'P1';
  if (own.length) return 'P2';
  return 'P3';
}
function deterministicReviewId(item) { return `j713-${hash({documentId:item.documentId,fileSha:item.fileSha,version:VERSION}).slice(0,24)}`; }
function buildCase(row, proposal, partialById) {
  const files = row.files || [];
  const file = files[0] || {};
  const ingestion = (row.ingestions || []).find(i => i.sourceCode === 'CSJN_TFN_HISTORICAL') || (row.ingestions || [])[0] || {};
  const partial = partialById.get(row.id);
  const missingComponents = partial?.missingComponents || [];
  const legalKeyImpact = { currentlyPartial:Boolean(partial), missingComponents, completesLegalKey:Boolean(partial && missingComponents.length===1 && missingComponents[0]==='SALA') };
  const evidence = proposal.evidence.map(e => {
    const snippet=String(e.rawSnippet || '').slice(0,360), match=snippet.match(/sala\s*(?:[:#-]\s*)?["“‘']?[a-m]["”’']?/iu);
    const start=match?.index ?? 0, end=match ? start+match[0].length : Math.min(snippet.length,80);
    return {type:e.type,page:e.page ?? null,position:e.position ?? null,sala:e.normalizedSala ?? null,selfReference:Boolean(e.selfReference),strength:e.strength ?? null,reason:e.reason ?? '',rawSnippet:snippet,context:{before:snippet.slice(Math.max(0,start-100),start),match:snippet.slice(start,end),after:snippet.slice(end,Math.min(snippet.length,end+100))},warning:['BODY_CITATION','RELATED_CASE'].includes(e.type)?'Referencia a otra Sala / evidencia no primaria':null};
  });
  const item = {reviewId:'',documentId:row.id,fileId:file.id || null,fileSha:file.sha256 || null,allFileShas:files.map(f=>f.sha256).filter(Boolean).sort(),source:{code:ingestion.sourceCode || 'CSJN_TFN_HISTORICAL',name:ingestion.sourceName || null,externalId:ingestion.externalId || null,reference:ingestion.sourceReference || null},decisionDate:row.decisionDate ? new Date(row.decisionDate).toISOString() : null,decisionYear:row.decisionDate ? new Date(row.decisionDate).getUTCFullYear() : null,caseNumber:row.caseNumber || row.docket || null,caseYear:row.metadata?.caseYear || row.metadataOriginal?.caseYear || null,court:row.court || null,currentSala:row.chamber || null,machineProposalSala:proposal.proposedSala,machineClassification:proposal.status,evidence,warnings:evidence.filter(e=>e.warning).map(e=>e.warning),legalKeyImpact,searchFilterImpact:{currentlyHiddenFromExactSalaFilter:!row.chamber,confirmationWouldEnableFilter:!row.chamber},inputHash:'',proposalHash:''};
  item.priority = priorityFor(item);
  item.reviewId = deterministicReviewId(item);
  item.proposalHash = caseEvidenceHash(item);
  return item;
}
function buildPack(rows, proposals, partialIds) {
  const byId = new Map(rows.map(r => [r.id,r]));
  const cases = proposals.filter(p=>p.status==='PROBABLE_HUMAN_CONFIRMATION').map(p=>buildCase(byId.get(p.documentId),p,partialIds)).sort((a,b)=>a.priority.localeCompare(b.priority)||String(a.machineProposalSala).localeCompare(String(b.machineProposalSala))||String(a.decisionDate).localeCompare(String(b.decisionDate))||a.documentId.localeCompare(b.documentId));
  const ambiguous = proposals.filter(p=>p.status==='AMBIGUOUS').map(p=>buildCase(byId.get(p.documentId),p,partialIds)).sort((a,b)=>String(a.machineProposalSala).localeCompare(String(b.machineProposalSala))||a.documentId.localeCompare(b.documentId));
  const body={schemaVersion:VERSION,queueName:'PROBABLE_HUMAN_CONFIRMATION',cases,ambiguousCases:ambiguous.map(x=>({...x,priority:'P3'}))};
  body.uatSampleReviewIds=makeUatSample(cases,25).reviewIds;
  body.inputHash=hash(body);
  for (const item of [...body.cases,...body.ambiguousCases]) item.inputHash=body.inputHash;
  body.reviewPackHash=hash({schemaVersion:body.schemaVersion,inputHash:body.inputHash,cases:body.cases,ambiguousCases:body.ambiguousCases});
  return body;
}
function makeDecision(item, decision, reviewer, chosenSala=null, comment='', reviewedAt=new Date().toISOString()) {
  return {reviewId:item.reviewId,documentId:item.documentId,proposedSala:item.machineProposalSala,decision,chosenSala:decision==='CONFIRM_PROPOSAL'?item.machineProposalSala:decision==='SET_OTHER_SALA'?chosenSala:null,reviewer:String(reviewer||'').trim(),comment:String(comment||''),reviewedAt,inputHash:item.inputHash,fileSha:item.fileSha,proposalHash:item.proposalHash};
}
function validateDecisionExport(input, pack, options={}) {
  const errors=[]; const decisions=Array.isArray(input)?input:input?.decisions;
  if(!Array.isArray(decisions)) return {status:'INVALID',errors:[{code:'DECISIONS_ARRAY_REQUIRED'}],decisions:[]};
  const manifest=input?.inputHash;
  if(manifest && manifest!==pack.inputHash) errors.push({code:'STALE_INPUT',message:'Este checkpoint corresponde a otra versión de la evidencia.'});
  if(input?.reviewPackHash && input.reviewPackHash!==pack.reviewPackHash) errors.push({code:'STALE_REVIEW_PACK',message:'Este checkpoint corresponde a otro paquete de revisión.'});
  const byId=new Map([...pack.cases,...(pack.ambiguousCases||[])].map(c=>[c.reviewId,c])); const seen=new Set();
  for(let i=0;i<decisions.length;i++){
    const d=decisions[i], at=`decisions[${i}]`;
    if(!d||typeof d!=='object'){errors.push({code:'INVALID_DECISION_ROW',at});continue;}
    if(seen.has(d.reviewId)) errors.push({code:'DUPLICATE_REVIEW_ID',at,reviewId:d.reviewId}); seen.add(d.reviewId);
    const item=byId.get(d.reviewId); if(!item){errors.push({code:'UNKNOWN_REVIEW_ID',at,reviewId:d.reviewId});continue;}
    if(d.documentId!==item.documentId) errors.push({code:'UNKNOWN_DOCUMENT',at});
    if(d.proposedSala!==item.machineProposalSala) errors.push({code:'PROPOSAL_MISMATCH',at});
    if(d.fileSha!==item.fileSha || d.proposalHash!==item.proposalHash) errors.push({code:'STALE_CASE',at});
    if(d.inputHash!==pack.inputHash) errors.push({code:'STALE_INPUT',at,message:'Este checkpoint corresponde a otra versión de la evidencia.'});
    if(!DECISIONS.includes(d.decision)) errors.push({code:'INVALID_DECISION',at});
    if(!String(d.reviewer||'').trim()) errors.push({code:'REVIEWER_REQUIRED',at});
    if(d.decision==='SET_OTHER_SALA' && !VALID_SALAS.has(d.chosenSala)) errors.push({code:'INVALID_SALA',at});
    if(d.decision==='CONFIRM_PROPOSAL' && d.chosenSala!==item.machineProposalSala) errors.push({code:'CONFIRM_SALA_MISMATCH',at});
    if(!Number.isFinite(Date.parse(d.reviewedAt||''))) errors.push({code:'INVALID_REVIEWED_AT',at});
  }
  if(options.complete && decisions.length!==pack.cases.length) errors.push({code:'INCOMPLETE_EXPORT',expected:pack.cases.length,actual:decisions.length});
  return {status:errors.length?'INVALID':options.complete?'COMPLETE':'IN_PROGRESS',errors,decisions};
}
function counts(decisions) { const out={reviewed:decisions.length,confirmed:0,otherSala:0,ambiguous:0,noEvidence:0,skipped:0}; for(const d of decisions){if(d.decision==='CONFIRM_PROPOSAL')out.confirmed++;else if(d.decision==='SET_OTHER_SALA')out.otherSala++;else if(d.decision==='AMBIGUOUS')out.ambiguous++;else if(d.decision==='NO_SALA_EVIDENCE')out.noEvidence++;else if(d.decision==='SKIP')out.skipped++;}return out; }
function makeUatSample(cases,size=25) {
  const remaining=cases.slice(),chosen=[];
  const take=predicate=>{const i=remaining.findIndex(predicate);if(i>=0)chosen.push(remaining.splice(i,1)[0]);};
  for(const sala of 'ABCDEFGHIJKLM') take(c=>c.machineProposalSala===sala);
  for(const y of ['2008','2009','2013']) take(c=>String(c.decisionYear??c.caseYear)===y);
  for(const type of ['HEADER_SELF','TRIBUNAL_SELF','SIGNATURE_SELF','TITLE']) take(c=>c.evidence.some(e=>e.type===type));
  for(const p of ['P0','P1','P2','P3']) take(c=>c.priority===p);
  while(chosen.length<size&&remaining.length) chosen.push(remaining.shift());
  const casesOut=chosen.slice(0,size);
  return {schemaVersion:VERSION,inputHash:casesOut[0]?.inputHash||null,size:casesOut.length,reviewIds:casesOut.map(c=>c.reviewId),distribution:{salas:[...new Set(casesOut.map(c=>c.machineProposalSala))].sort(),years:[...new Set(casesOut.map(c=>String(c.decisionYear??c.caseYear)))].sort(),evidenceTypes:[...new Set(casesOut.flatMap(c=>c.evidence.map(e=>e.type)))].sort(),priorities:[...new Set(casesOut.map(c=>c.priority))].sort()},decisionsCreated:0};
}
function csv(records) { const cols=['reviewId','documentId','proposedSala','decision','chosenSala','reviewer','comment','reviewedAt','inputHash','fileSha','proposalHash'];const cell=v=>{const s=v==null?'':String(v);return /[",\r\n]/u.test(s)?`"${s.replace(/"/gu,'""')}"`:s;};return [cols.join(','),...records.map(r=>cols.map(k=>cell(r[k])).join(','))].join('\r\n')+'\r\n'; }
function parseCsv(text) {const rows=[];let row=[],field='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}else if(c==='"')quoted=true;else if(c===','){row.push(field);field='';}else if(c==='\n'){row.push(field.replace(/\r$/u,''));rows.push(row);row=[];field='';}else field+=c;}if(quoted)throw Error('CSV_UNTERMINATED_QUOTE');if(field.length||row.length){row.push(field.replace(/\r$/u,''));rows.push(row);}if(!rows.length)return[];const headers=rows.shift();if(new Set(headers).size!==headers.length)throw Error('CSV_DUPLICATE_HEADER');return rows.filter(r=>r.some(x=>x!=='')).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));}
module.exports={VERSION,VALID_SALAS,DECISIONS,stable,hash,caseEvidenceHash,priorityFor,deterministicReviewId,buildCase,buildPack,makeDecision,validateDecisionExport,counts,makeUatSample,csv,parseCsv};

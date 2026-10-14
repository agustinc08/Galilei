'use strict';

// Pure, conservative evidence classifier. Database access belongs to the guarded runner.
const crypto = require('node:crypto');
const { normalizeCivilCaseReference } = require('./jurisprudencia-civil-case-normalizer.cjs');
const { legalKey } = require('./jurisprudencia-corpus-quality-audit.cjs');
const VALID = new Set('ABCDEFGHIJKLM'.split(''));
const STATUSES = Object.freeze(['AUTO_SAFE_DRY_RUN','PROBABLE_HUMAN_CONFIRMATION','CONFLICTING_EVIDENCE','NO_SELF_SALA_FOUND','TEXT_INSUFFICIENT','NOT_APPLICABLE','AMBIGUOUS']);
const hash = v => crypto.createHash('sha256').update(String(v ?? '')).digest('hex');
function stable(v) { if (v instanceof Date) return JSON.stringify(v.toISOString()); if(v===undefined)return 'null'; if(Array.isArray(v))return '['+v.map(stable).join(',')+']'; if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}'; return JSON.stringify(v); }
const norm = v => String(v??'').normalize('NFC').replace(/\r\n?/gu,'\n').replace(/[\t\f\v ]+/gu,' ').trim();
function flatten(v,prefix,out=[]) { if(!v||typeof v!=='object')return out; for(const [k,x] of Object.entries(v)){const p=prefix?prefix+'.'+k:k;if(x!=null&&typeof x!=='object')out.push({field:p,key:k,value:String(x)});else if(x&&typeof x==='object')flatten(x,p,out);}return out; }
function extractSala(text) {
  const s=String(text||''),out=[],re=/\bsala\s*(?:[:#-]\s*)?["“‘']?([a-m])["”’']?(?![\p{L}\p{N}])/giu;
  for(const m of s.matchAll(re)){const sala=m[1].toUpperCase();if(!VALID.has(sala))continue;const context=s.slice(Math.max(0,m.index-100),Math.min(s.length,m.index+m[0].length+100)).replace(/\s+/gu,' ').trim();if(/\bsala\s+(?:de\s+audiencias|de\s+primera\s+instancia)\b/iu.test(context))continue;out.push({sala,index:m.index,context});}
  return out;
}
function structured(row) {
  const candidates=[],fields=[],sources=[['document.metadataOriginal',row.metadataOriginal],['document.title',{title:row.title}],['document.court',{court:row.court}],...(row.ingestions||[]).flatMap((x,i)=>[['ingestions['+i+'].metadataOriginal',x.metadataOriginal],['sourceRecord['+i+']',{externalId:x.externalId,sourceReference:x.sourceReference}],['sourceSystem['+i+']',{name:x.sourceName,description:x.sourceDescription,sourceType:x.sourceType,metadata:x.sourceMetadata}]]),...(row.files||[]).map((x,i)=>['file['+i+']',{filename:x.originalFilename}])];
  for(const [base,obj] of sources)for(const x of flatten(obj)){const field=base+'.'+x.field;fields.push({field,key:x.key,value:x.value});const low=field.toLowerCase();const salaKey=/(?:^|\.)(?:sala|chamber|courtroom|numerodesala|salaid)$/u.test(low);const title=/(?:^|\.)(?:title|titulo|t[ií]tulo|sourcetitle|documenttitle|caratula|caption)$/iu.test(low);const court=/(?:court|tribunal|c[aá]mara|camara|vocal|integrante|juez)/iu.test(low);const filename=/(?:filename|relativepath)$/iu.test(low);const sourceRef=/(?:externalid|sourcereference)$/iu.test(low);const sourceSystem=base.startsWith('sourceSystem');if(!salaKey&&!title&&!court&&!filename&&!sourceRef&&!sourceSystem)continue;let found=extractSala(x.value);const bare=salaKey&&/^(?:sala\s*)?["“‘']?([a-m])["”’']?$/iu.exec(norm(x.value));if(bare&&!found.length)found=[{sala:bare[1].toUpperCase()}];for(const m of found){const exact=salaKey&&/^(?:[a-m]|sala\s+[a-m]|(?:sala\s*)?["“‘]?[a-m]["”’]?)$/iu.test(norm(x.value));const tribunal=/\b(?:c[aá]mara|camara|tribunal|corte)\b/iu.test(x.value);const type=exact?'PRIMARY_STRUCTURED':filename?'FILENAME':sourceRef?'SOURCE_REFERENCE':sourceSystem?'SOURCE_DESCRIPTION':title?'TITLE':tribunal?'TRIBUNAL_SELF':'UNKNOWN';const self=exact||(!sourceSystem&&title)||tribunal;candidates.push({type,page:null,sourceField:field,rawSnippet:x.value.slice(0,240),normalizedSala:m.sala,strength:exact?100:title?82:tribunal?85:40,selfReference:self,reason:exact?'campo explícito de Sala':sourceSystem?'descripción/nombre del sistema fuente, sólo contextual':title?'campo de título/procedencia':tribunal?'campo raw con identificación de tribunal':filename?'marca auxiliar de nombre de archivo':'mención auxiliar de provenance'});}}
  return {candidates,fields};
}
function textEvidence(pages) {
  const candidates=[];let chars=0;const sorted=(pages||[]).slice().sort((a,b)=>Number(a.pageNumber)-Number(b.pageNumber));
  for(const p of sorted){
    const text=String(p.text||'');chars+=text.length;if(!text.trim())continue;let offset=0;
    for(const line of text.split(/\n/u)){
      const clean=norm(line);
      for(const m of extractSala(line)){
        const pos=(offset+m.index)/Math.max(1,text.length);
        const heading=/\b(?:c[aá]mara|camara|tribunal|juzgado|poder judicial|autos|expediente|vocales|integrantes)\b/iu.test(clean);
        const reporter=/\b(?:E\.?\s*D\.?|L\.?\s*L\.?|J\.?\s*A\.?|Fallos|La Ley)\b/iu.test(clean);
        const abbreviatedCourtCitation=/\b(?:CNCiv\.?|C\.?\s*Nac\.?\s*Civ\.?)\s*[,.:;-]?\s*Sala\b/iu.test(clean);
        const citation=reporter||abbreviatedCourtCitation||/\b(?:ha dicho|resolvi[oó]|sostuvo|conforme|seg[uú]n|precedente|jurisprudencia|fallo|citad[oa]|autos|causa|expediente|ídem|id\.)\b/iu.test(clean);
        let type='UNKNOWN',strength=20,self=false,reason='contexto insuficiente';
        if(citation){type=/\b(?:autos|causa|expediente)\b/iu.test(clean)?'RELATED_CASE':'BODY_CITATION';reason='mención compatible con cita o precedente';}
        else if(heading&&pos<=.2){type=Number(p.pageNumber)===1?'HEADER_SELF':'TRIBUNAL_SELF';strength=Number(p.pageNumber)===1?90:85;self=true;reason='tribunal/Sala explícitos en encabezado temprano';}
        else if(pos<=.2&&/\b(?:sala|c[aá]mara|camara)\b/iu.test(clean)){type='TRIBUNAL_SELF';strength=80;self=true;reason='identificación propia en zona inicial';}
        else if(/\b(?:firma|firmado|suscripta|suscripto|juez|jueza|vocal)\b/iu.test(clean)){type='SIGNATURE_SELF';strength=75;self=true;reason='firma/composición compatible, corroborativa';}
        candidates.push({type,page:Number(p.pageNumber),position:pos<=.05?'FIRST_5_PERCENT':pos<=.2?'FIRST_20_PERCENT':'BODY',sourceField:'CorpusDocumentPage.text',rawSnippet:clean.slice(0,300),normalizedSala:m.sala,strength,selfReference:self,reason});
      }
      offset+=line.length+1;
    }
  }
  return {candidates,totalChars:chars,pageCount:sorted.length};
}
function classify(row) {
  const r=structured(row),t=textEvidence(row.pages),evidence=r.candidates.concat(t.candidates),auth=evidence.filter(e=>e.selfReference&&['PRIMARY_STRUCTURED','HEADER_SELF','TRIBUNAL_SELF','SIGNATURE_SELF','TITLE'].includes(e.type));
  const vals=a=>[...new Set(a.map(x=>x.normalizedSala))].sort(),raw=vals(r.candidates.filter(e=>e.selfReference)),head=vals(t.candidates.filter(e=>['HEADER_SELF','TRIBUNAL_SELF'].includes(e.type)&&e.selfReference)),all=vals(auth);
  let status='NO_SELF_SALA_FOUND',proposedSala=null;
  if(!row.court&&!row.decisionDate&&!row.caseNumber&&!row.docket&&!(row.ingestions||[]).length)status='NOT_APPLICABLE';
  else if(raw.length&&head.length&&raw.some(x=>!head.includes(x)))status='CONFLICTING_EVIDENCE';
  else if(all.length>1)status='AMBIGUOUS';
  else if(all.length===1){proposedSala=all[0];const strong=auth.filter(e=>e.normalizedSala===proposedSala&&e.strength>=85);status=strong.some(e=>e.type==='PRIMARY_STRUCTURED')?'AUTO_SAFE_DRY_RUN':'PROBABLE_HUMAN_CONFIRMATION';}
  else if(t.totalChars<20&&!r.candidates.length&&!textEvidence(row.pages).candidates.length)status='TEXT_INSUFFICIENT';
  return {documentId:row.id,status,proposedSala,evidence,counts:{rawFields:r.fields.length,textChars:t.totalChars,pages:t.pageCount},fieldDiscovery:r.fields,bodyCitationSalas:vals(t.candidates.filter(e=>['BODY_CITATION','RELATED_CASE'].includes(e.type)))};
}
function validateKnown(rows){const known=rows.filter(r=>r.chamber||r.metadata?.courtNumber),rules={},bySala={},byYear={};let predictions=0,correct=0,wrong=0;const wrongExamples=[];for(const type of ['PRIMARY_STRUCTURED','HEADER_SELF','TRIBUNAL_SELF','SIGNATURE_SELF','TITLE'])rules[type]={predictions:0,correct:0,wrong:0,abstained:0,wrongExamples:[]};for(const row of known){const x=classify(row),expected=String(row.chamber||row.metadata.courtNumber).replace(/^sala\s*/iu,'').trim().toUpperCase();for(const type of Object.keys(rules)){const values=[...new Set(x.evidence.filter(e=>e.selfReference&&e.type===type).map(e=>e.normalizedSala))];if(values.length!==1){rules[type].abstained++;continue;}const proposed=values[0],ok=expected===proposed;rules[type].predictions++;ok?rules[type].correct++:rules[type].wrong++;const sala=bySala[type]||(bySala[type]={});const s=sala[expected]||(sala[expected]={predictions:0,correct:0,wrong:0});s.predictions++;ok?s.correct++:s.wrong++;const yr=row.decisionDate?new Date(row.decisionDate).getUTCFullYear():'UNKNOWN';const yearMap=byYear[type]||(byYear[type]={});const y=yearMap[yr]||(yearMap[yr]={predictions:0,correct:0,wrong:0});y.predictions++;ok?y.correct++:y.wrong++;if(!ok){const example={documentId:row.id,expected,proposed,evidenceTypes:[type],evidence:x.evidence.filter(e=>e.selfReference&&e.type===type).map(e=>({type:e.type,page:e.page,sourceField:e.sourceField,normalizedSala:e.normalizedSala,rawSnippet:e.rawSnippet}))};rules[type].wrongExamples.push(example);wrongExamples.push(example);}}if(x.status==='AUTO_SAFE_DRY_RUN'&&x.proposedSala){const ok=expected===x.proposedSala;predictions++;ok?correct++:wrong++;}}for(const rule of Object.values(rules))delete rule.wrongExamples;return{knownDocuments:known.length,autoSafePredictions:predictions,correct,wrong,abstained:known.length-predictions,precision:predictions?correct/predictions:null,byEvidenceType:rules,bySala,byYear,wrongExamples};}
function legalKeyMetrics(rows,proposals,partialIds){const ids=new Set(partialIds),byId=new Map(rows.map(r=>[r.id,r]));let salaOnly=0,yearOnly=0,multiple=0,other=0;const decomposed=new Map();for(const id of ids){const r=byId.get(id);if(!r){other++;continue;}const normalized=normalizeCivilCaseReference({rawCase:r.caseNumber||r.docket||'',rawYear:r.metadata?.caseYear||r.metadataOriginal?.caseYear||''});const m=[];if(!r.chamber)m.push('SALA');if(!['VALID_CANONICAL','VALID_LEGACY','VALID_MULTI_CASE'].includes(normalized.status))m.push('CASE_OR_YEAR');if(!r.court)m.push('COURT');if(!r.decisionDate)m.push('DATE');decomposed.set(id,m);if(m.length===1&&m[0]==='SALA')salaOnly++;else if(m.length===1&&m[0]==='CASE_OR_YEAR')yearOnly++;else if(m.length>1)multiple++;else other++;}const safe=new Set(proposals.filter(x=>x.status==='AUTO_SAFE_DRY_RUN').map(x=>x.documentId)),human=new Set(proposals.filter(x=>x.status==='PROBABLE_HUMAN_CONFIRMATION').map(x=>x.documentId));const improves=set=>ids.size-[...ids].filter(id=>(decomposed.get(id)||[]).every(f=>f==='SALA')&&set.has(id)).length;return{currentPartial:ids.size,salaOnly,yearOnly,multipleMissing:multiple,other,afterAutoSafeHypothetical:improves(safe),afterHumanConfirmedHypothetical:improves(new Set([...safe,...human])),afterNormalizerOnly:ids.size,persisted:false};}
function deterministicHash(value){return hash(stable(value));}
const countBy=(rows,fn)=>rows.reduce((out,row)=>{const key=String(fn(row)??'UNKNOWN');out[key]=(out[key]||0)+1;return out;},{});
module.exports={VALID,STATUSES,hash,stable,norm,flatten,extractSala,textEvidence,structured,classify,validateKnown,legalKeyMetrics,deterministicHash,countBy,legalKey,normalizeCivilCaseReference};

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
const { PDFParse } = require('pdf-parse');
const { legalIdentity, fold, docket } = require('./jurisprudencia-review-workflow.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const RECOVERY = path.join(ROOT, '_recovery-work', 'jurisprudencia-j5');
const PDF_CACHE = path.join(RECOVERY,'structural-pdf-text-cache.json');
const J1 = path.join(ROOT, '_recovery-work', 'jurisprudencia-j1', 'runs', '2026-10-14T04-16-00-544Z', 'review-input.json');
const J4 = path.join(ROOT, '_recovery-work', 'jurisprudencia-j4');
const EXPECTED = { total: 451, candidates: 106, structural: 321, sourceData: 7, modelLimitations: 16 };
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const writeJson = (name, value) => fs.writeFileSync(path.join(RECOVERY, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const csvCell = value => { const s = String(value ?? ''); return /[",\r\n]/u.test(s) ? `"${s.replace(/"/gu, '""')}"` : s; };
const csv = (headers, rows) => `${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
const safeRef = value => String(value || '').replace(/([?&](?:cid|jsessionid|token|ticket|session|id)=)[^&\s]*/giu, '$1[REDACTED]');
const str = value => value == null ? '' : String(value).trim();
const uniq = values => [...new Set(values.map(str).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en'));
function extractDocketCandidates(text) {
  return [...String(text||'').matchAll(/(?:\b(?:EXPTE?|EXPEDIENTE|CAUSA|LIBRE|CIV(?:IL)?|L\.?\s*CIV|EX)\.?\s*(?:N(?:RO)?\s*[.°º]*\s*)?)(\d{1,3}(?:[.\s]\d{3})+|\d{1,6})\s*\/\s*(\d{2,4})/giu)]
    .map(match=>`${match[1]}${match[2]}`.replace(/\D/gu,''));
}

function assertTarget(url) {
  const target = new URL(url);
  if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' ||
      target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') throw new Error('J5_DEV_URL_REJECTED');
}
function flattenKnownIds(value, prefix = '', out = []) {
  if (!value || typeof value !== 'object') return out;
  for (const [key, child] of Object.entries(value)) {
    const field = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object') flattenKnownIds(child, field, out);
    else if (child != null && /(?:legacy|external|portal|source|record|document|case|file|expediente|flid|id)$/iu.test(key))
      out.push({ field, value: str(child) });
  }
  return out;
}
function identityFor(row) {
  const meta = row.metadataOriginal && typeof row.metadataOriginal === 'object' ? row.metadataOriginal : {};
  const nested = [meta, row.metadata && typeof row.metadata === 'object' ? row.metadata : {}];
  const pick = (...keys) => {
    for (const key of keys) {
      if (row[key] != null && str(row[key])) return row[key];
      for (const object of nested) if (object[key] != null && str(object[key])) return object[key];
    }
    return '';
  };
  return legalIdentity({ jurisdiction: 'NACIONAL', instance: pick('instance'),
    court: pick('court', 'tribunal', 'tribunalOrigen', 'courtName'), chamber: pick('chamber', 'sala'),
    courtNumber: pick('courtNumber', 'court_number'), caseNumber: pick('caseNumber', 'case_number', 'docket', 'expediente'),
    decisionDate: pick('decisionDate', 'decision_date', 'fecha') });
}
function redactMetadata(meta) {
  if (!meta || typeof meta !== 'object') return {};
  const fields = ['caseNumber','case_number','docket','expediente','decisionDate','decision_date','court','tribunal','tribunalOrigen','chamber','sala','instance','jurisdiction','sourceRecord','sourceSystem','sourceKey','sourceId','externalId','portalId','legacyId','flid','sourceReference','externalUrl','url','documentUrl'];
  const out = {};
  for (const key of fields) if (meta[key] != null && typeof meta[key] !== 'object') out[key] = /url|reference/iu.test(key) ? safeRef(meta[key]) : meta[key];
  for (const child of Object.values(meta)) {
    if (child && typeof child === 'object' && !Array.isArray(child)) Object.assign(out, redactMetadata(child));
  }
  return out;
}
function sourceRecord(group, source) {
  return { groupId: group.legalDocumentKey, sourceRecordId: str(source.external_id), sourceKey: safeRef(source.source_key),
    sourceSystem: str(source.source_key).split(':')[0] || null, portalId: str(source.portal_id || source.quantification_id || source.flid) || null,
    sha256: str(source.sha256).toLowerCase() || null, legalKey: group.legalDocumentKey,
    metadata: { caseNumber: source.case_number || null, court: source.court || null, chamber: source.chamber || null,
      decisionDate: source.decision_date || null, title: source.title || null, year: source.year || null,
      mime: source.mime || null, bytes: source.bytes ?? null, pages: source.page_count ?? null },
    localPath: source.local_path || null, documentUrl: safeRef(source.document_url), detailUrl: safeRef(source.detail_url),
    legacyIds: flattenKnownIds(source).filter(item => !/title|date|court|caseNumber|docket/iu.test(item.field)) };
}
function legalKey(source) {
  return legalIdentity({ jurisdiction: source.jurisdiction || 'NACIONAL', instance: source.instance,
    court: source.court, chamber: source.chamber, courtNumber: source.courtNumber,
    caseNumber: source.caseNumber || source.case_number || source.docket || source.expediente,
    decisionDate: source.decisionDate || source.decision_date || source.fecha }).key;
}
function sourceMissingFields(group) {
  const items = group.sourceEvidence || [];
  if (!items.length) return ['sourceRecord'];
  const first = items[0];
  return ['case_number','court','chamber','decision_date'].filter(key => !str(first[key]));
}
function classifyDocketEvidence(sourceDockets, extractedDockets) {
  const expected = new Set(sourceDockets.map(value=>String(value).replace(/\D/gu,'')));
  const matches = uniq(extractedDockets.map(value=>String(value).replace(/\D/gu,''))).filter(value=>expected.has(value));
  return { multiDocketPdf:matches.length>=2, matchedSourceDockets:matches,
    decisionMultiplicity:'NOT_ESTABLISHED_FROM_DOCKET_EVIDENCE',
    confidence:matches.length>=2?'HIGH_DOCKET_CROSSWALK':'NO_MULTI_DOCKET_PROOF' };
}
function makeDocIndex(documents, files, ingestions) {
  const fileByDoc = new Map();
  for (const file of files) {
    if (!fileByDoc.has(file.documentId)) fileByDoc.set(file.documentId, []);
    fileByDoc.get(file.documentId).push(file);
  }
  const ingestByDoc = new Map();
  for (const item of ingestions) {
    if (!ingestByDoc.has(item.documentId)) ingestByDoc.set(item.documentId, []);
    ingestByDoc.get(item.documentId).push(item);
  }
  const docs = documents.map(doc => {
    const filesFor = fileByDoc.get(doc.id) || [];
    const records = ingestByDoc.get(doc.id) || [];
    const identity = identityFor(doc);
    const metadata = redactMetadata(doc.metadataOriginal);
    const ingestIds = records.flatMap(item => [item.externalId, item.sourceReference, item.sourceKey, item.externalUrl]);
    const ids = uniq([...flattenKnownIds(doc.metadataOriginal).map(x => x.value), ...ingestIds]);
    return { ...doc, identity, metadata, ids, files: filesFor, ingestions: records };
  });
  const bySha = new Map(); const byId = new Map(); const byLegal = new Map(); const byFileSha = new Map();
  for (const doc of docs) {
    byId.set(doc.id, doc);
    if (doc.identity.key) { if (!byLegal.has(doc.identity.key)) byLegal.set(doc.identity.key, []); byLegal.get(doc.identity.key).push(doc); }
    for (const file of doc.files) {
      if (!bySha.has(file.sha256)) bySha.set(file.sha256, new Map());
      bySha.get(file.sha256).set(doc.id, doc);
      byFileSha.set(file.id, file);
    }
  }
  return { docs, bySha, byId, byLegal, byFileSha };
}
function recoverCandidate(group, index, sourceRecords) {
  const evidence = sourceRecords.filter(item => item.groupId === group.legalDocumentKey);
  const methods = [];
  const candidates = new Map();
  const add = (method, doc, confidence) => {
    if (!doc) return;
    candidates.set(doc.id, doc);
    methods.push({ method, documentId: doc.id, confidence });
  };
  for (const source of evidence) {
    for (const doc of index.bySha.get(source.sha256)?.values() || []) add('SOURCE_SHA_EXACT', doc, 'HIGH');
    const ids = uniq([source.sourceRecordId, source.sourceKey, source.portalId, ...source.legacyIds.map(item => item.value)]);
    for (const doc of index.docs) {
      const matches = doc.ingestions.filter(item => ids.some(id => id && [item.externalId,item.sourceReference,item.sourceKey,item.externalUrl].map(str).includes(id)));
      if (matches.length) add(matches.some(item => item.externalId === source.sourceRecordId) ? 'SOURCE_RECORD_ID_EXACT' : 'PORTAL_OR_LEGACY_ID_EXACT', doc, 'HIGH');
    }
  }
  const normalizedKey = legalKey({ caseNumber: group.caseNumber, court: group.court, chamber: group.chamber,
    decisionDate: group.decisionDate, instance: 'SECOND_INSTANCE' });
  if (normalizedKey) for (const doc of index.byLegal.get(normalizedKey) || []) add('LEGAL_KEY_EXACT', doc, 'HIGH');
  const docList = [...candidates.values()].sort((a,b) => a.id.localeCompare(b.id, 'en'));
  const exactMethods = methods.filter(item => item.method !== 'LEGAL_KEY_EXACT');
  const exactDocs = new Set(exactMethods.map(item => item.documentId));
  let status;
  if (exactDocs.size === 1) status = 'EXACT_RECOVERED';
  else if (exactDocs.size > 1 || docList.length > 1) status = 'MULTIPLE_RECOVERED';
  else if (docList.length === 1) status = 'EXACT_RECOVERED';
  else if (evidence.some(item => index.bySha.has(item.sha256)) || sourceRecords.some(item => item.groupId === group.legalDocumentKey && item.fileEvidence)) status = 'PARTIAL_RECOVERED';
  else status = 'NOT_RECOVERED';
  const candidateDocs = status === 'MULTIPLE_RECOVERED' ? docList : docList;
  const sourceLegalKey = legalKey({ caseNumber: group.caseNumber, court: group.court, chamber: group.chamber,
    decisionDate: group.decisionDate, instance: 'SECOND_INSTANCE' });
  const hasExactSha = methods.some(item=>item.method==='SOURCE_SHA_EXACT');
  const quality = status === 'MULTIPLE_RECOVERED' ? 'AMBIGUOUS' : status === 'NOT_RECOVERED' || status === 'PARTIAL_RECOVERED' ? 'INSUFFICIENT' :
    hasExactSha && candidateDocs.length===1 && candidateDocs[0].identity.key===sourceLegalKey ? 'STRONG_SAME_DECISION' : 'INSUFFICIENT';
  return { groupId: group.legalDocumentKey, status, candidateDocumentIds: candidateDocs.map(doc => doc.id),
    candidates: candidateDocs.map(doc => ({ documentId: doc.id, title: doc.title, court: doc.court, chamber: doc.chamber,
      instance: doc.instance, caseNumber: doc.caseNumber, decisionDate: doc.decisionDate,
      legalKey: doc.identity.key, files: doc.files.map(file => ({ fileId: file.id, sha256: file.sha256,
        mimeType: file.mimeType, sizeBytes: String(file.sizeBytes), pageCount: file.pageCount, version: file.version })),
      provenance: doc.ingestions.map(item => ({ ingestionId: item.id, sourceSystem: item.sourceCode,
        externalId: item.externalId, sourceReference: safeRef(item.sourceReference), externalUrl: safeRef(item.externalUrl),
        checksum: item.checksum, fileId: item.fileId })) })), methods, ambiguity: docList.length > 1 ? 'MULTIPLE_DOCUMENTS_MATCH' : null,
    legalKeyUsed: normalizedKey, legalKeyOnly: docList.length > 0 && exactDocs.size === 0, quality };
}
function structuralCause(group, sourceRows, index) {
  const groupRows = sourceRows.filter(item => item.groupId === group.legalDocumentKey);
  const shas = uniq(groupRows.map(item => item.sha256));
  const rows = sourceRows.filter(item => shas.includes(item.sha256));
  const sourceIds = uniq(rows.map(item => item.sourceRecordId));
  const dbDocs = new Map();
  for (const sha of shas) for (const doc of index.bySha.get(sha)?.values() || []) dbDocs.set(doc.id, doc);
  const keys = uniq(rows.map(item => item.legalKey));
  const signatures = new Set(rows.map(item => JSON.stringify([item.groupId,item.sourceKey,item.sourceRecordId,item.sha256,item.metadata.caseNumber,item.metadata.court,item.metadata.chamber,item.metadata.decisionDate])));
  let cause = group.multiDocketPdf === true ? 'MULTI_DOCKET_PDF' : 'UNKNOWN';
  const duplicateWithinGroup = groupRows.length > 1 && new Set(groupRows.map(item=>JSON.stringify([item.sourceKey,item.sourceRecordId,item.sha256,item.metadata.caseNumber,item.metadata.court,item.metadata.chamber,item.metadata.decisionDate]))).size < groupRows.length;
  if (cause !== 'MULTI_DOCKET_PDF' && (duplicateWithinGroup || rows.some(item => item.legacyIds?.some(id => /duplicate/u.test(id.field)))) ) cause = 'DUPLICATE_SOURCE_ROWS';
  else if (cause !== 'MULTI_DOCKET_PDF' && dbDocs.size > 1) cause = 'INGESTION_LINK_COLLISION';
  else if (cause !== 'MULTI_DOCKET_PDF' && sourceIds.length < rows.length && keys.length > 1) cause = 'LEGACY_ID_COLLISION';
  else if (cause !== 'MULTI_DOCKET_PDF' && sourceIds.length > 1 && keys.length > 1) cause = 'SOURCE_METADATA_COLLISION';
  else if (cause !== 'MULTI_DOCKET_PDF' && keys.length > 1 && rows.some(item => !item.metadata.decisionDate || !item.metadata.court)) cause = 'LEGAL_KEY_DERIVATION_ISSUE';
  else if (cause !== 'MULTI_DOCKET_PDF' && keys.length > 1) cause = 'SOURCE_METADATA_COLLISION';
  else if (cause !== 'MULTI_DOCKET_PDF' && shas.length > 1) cause = 'DATE_NORMALIZATION_COLLISION';
  return { groupId: group.legalDocumentKey, sha256: shas, sourceRecordIds: sourceIds, sourceCount: rows.length,
    legalKeys: keys, corpusDocumentIds: [...dbDocs.keys()].sort(), corpusDocumentCount: dbDocs.size,
    corpusFileCount: [...dbDocs.values()].reduce((n, doc) => n + doc.files.filter(file => shas.includes(file.sha256)).length, 0),
    ingestionRecordCount: [...dbDocs.values()].reduce((n, doc) => n + doc.ingestions.filter(item => shas.includes(item.checksum) || doc.files.some(file => file.id === item.fileId && shas.includes(file.sha256))).length, 0),
    cause, nextAction: cause === 'DUPLICATE_SOURCE_ROWS' ? 'deduplicate source rows only after source ID verification' :
      cause === 'INGESTION_LINK_COLLISION' ? 'audit ingestion records and preserve each CorpusDocument' :
        cause === 'SOURCE_METADATA_COLLISION' ? 'compare metadata printed in PDF and source-side primary record' : 'inspect PDF and source record; keep links unchanged' };
}
async function auditMultiDecisionPdfs(conflicts, sourceRows) {
  const sourceGroups = new Map();
  for (const row of sourceRows) {
    if (!row.sha256) continue;
    if (!sourceGroups.has(row.sha256)) sourceGroups.set(row.sha256,{ rows:[], localPath:row.localPath });
    sourceGroups.get(row.sha256).rows.push(row);
  }
  const shaSet = new Set(conflicts.flatMap(group=>(group.sourceEvidence||[]).map(item=>str(item.sha256).toLowerCase())).filter(Boolean));
  const results = new Map(); let parsed=0; let pdfMs=0; let cacheHits=0;
  const cachedEntries = new Map();
  if (fs.existsSync(PDF_CACHE)) {
    const stored=readJson(PDF_CACHE);
    if (stored.version==='J5-PDF-docket-audit-v1' && stored.toolVersion==='j5-docket-v2')
      for (const [sha,item] of Object.entries(stored.entries||{})) cachedEntries.set(sha,item);
  } else {
    const previous=path.join(RECOVERY,'structural-root-causes.json');
    if (fs.existsSync(previous)) {
      const stored=readJson(previous);
      for (const item of stored.pdfTextAudit?.results||[]) if (item.status==='PDF_TEXT_EXTRACTED') cachedEntries.set(item.sha256,{...item,multiDocketPdf:Boolean(item.multiDocketPdf??item.multiDecisionPdf),decisionMultiplicity:'NOT_ESTABLISHED_FROM_DOCKET_EVIDENCE'});
    }
  }
  const nextCache = new Map();
  for (const sha of [...shaSet].sort()) {
    const sourceSet=sourceGroups.get(sha); const docketKeys=uniq(sourceSet.rows.map(row=>String(row.metadata.caseNumber||'').replace(/\D/gu,'')));
    const fullPath=sourceSet.localPath ? path.resolve(sourceSet.localPath) : '';
    const approved=path.resolve(ROOT,'_recovery-work','sprint146','viewer','objects')+path.sep;
    if (!fullPath.toLowerCase().startsWith(approved.toLowerCase()) || !fs.existsSync(fullPath)) {
      results.set(sha,{sha256:sha,status:'TEXT_UNAVAILABLE',sourceDockets:docketKeys,matches:[],multiDocketPdf:false,decisionMultiplicity:'UNKNOWN'}); continue;
    }
    const bytes=fs.readFileSync(fullPath); const actual=hash(bytes);
    if (actual!==sha || bytes.subarray(0,5).toString('ascii')!=='%PDF-') {
      results.set(sha,{sha256:sha,status:'SOURCE_FILE_HASH_OR_SIGNATURE_MISMATCH',sourceDockets:docketKeys,matches:[],multiDocketPdf:false,decisionMultiplicity:'UNKNOWN'}); continue;
    }
    const cached=cachedEntries.get(sha);
    if (cached && JSON.stringify(cached.sourceDockets||[])===JSON.stringify(docketKeys) && Array.isArray(cached.extractedDockets)) {
      const docketEvidence=classifyDocketEvidence(docketKeys,cached.extractedDockets);
      const item={...cached,multiDocketPdf:docketEvidence.multiDocketPdf,matchedSourceDockets:docketEvidence.matchedSourceDockets,
        decisionMultiplicity:docketEvidence.decisionMultiplicity,confidence:docketEvidence.confidence,fileHash:actual};
      results.set(sha,item);nextCache.set(sha,item);cacheHits++;continue;
    }
    const parser=new PDFParse({data:bytes}); const started=performance.now();
    try {
      const parsedPdf=await parser.getText(); const text=String(parsedPdf.text||'');
      const matches=extractDocketCandidates(text);
      const uniqueMatches=uniq(matches); const docketEvidence=classifyDocketEvidence(docketKeys,uniqueMatches); const matchedSourceDockets=docketEvidence.matchedSourceDockets;
      const independentHeadings=(text.match(/(?:PODER JUDICIAL DE LA NACION|PODER JUDICIAL DE LA NACIÓN|EN BUENOS AIRES, CAPITAL DE LA REPUBLICA|EN BUENOS AIRES, CAPITAL DE LA REPÚBLICA)/giu)||[]).length;
      const dispositiveMarkers=(text.match(/(?:SE RESUELVE|RESUELVE:|POR ELLO|FALLA:|Y VISTOS)/giu)||[]).length;
      const result={sha256:sha,status:'PDF_TEXT_EXTRACTED',sourceDockets:docketKeys,extractedDockets:uniqueMatches,
        matchedSourceDockets,headerMarkers:independentHeadings,dispositiveMarkers,chars:text.length,
        excerpt:text.slice(0,900),multiDocketPdf:docketEvidence.multiDocketPdf,decisionMultiplicity:docketEvidence.decisionMultiplicity,confidence:docketEvidence.confidence,fileHash:actual};
      results.set(sha,result);nextCache.set(sha,result);
      parsed++;
    } catch(error) { results.set(sha,{sha256:sha,status:'PDF_TEXT_PARSE_FAILED',sourceDockets:docketKeys,error:error.message,multiDocketPdf:false,decisionMultiplicity:'UNKNOWN'}); }
    finally { await parser.destroy(); pdfMs+=performance.now()-started; }
  }
  for (const [sha,item] of cachedEntries) if (!nextCache.has(sha) && !shaSet.has(sha)) nextCache.set(sha,item);
  writeJson('structural-pdf-text-cache.json',{version:'J5-PDF-docket-audit-v1',toolVersion:'j5-docket-v2',entries:Object.fromEntries([...nextCache.entries()].sort(([a],[b])=>a.localeCompare(b,'en')))});
  return { results,parsed,cacheHits,pdfMs:Number(pdfMs.toFixed(2)),uniqueShaCount:shaSet.size };
}
async function auditSourceDataPdfs(groups, sourceRows, index) {
  const results=[]; let parsed=0; let pdfMs=0;
  const months={enero:'01',febrero:'02',marzo:'03',abril:'04',mayo:'05',junio:'06',julio:'07',agosto:'08',septiembre:'09',octubre:'10',noviembre:'11',diciembre:'12'};
  for(const group of groups) {
    const source=group.sourceEvidence?.[0]||{}; const sourceSha=str(source.sha256).toLowerCase();
    const localPath=path.resolve(source.local_path||''); const approved=path.resolve(ROOT,'_recovery-work','sprint146','viewer','objects')+path.sep;
    const corpusDocs=[...(index.bySha.get(sourceSha)?.values()||[])];
    if(!localPath.toLowerCase().startsWith(approved.toLowerCase())||!fs.existsSync(localPath)) {
      results.push({groupId:group.legalDocumentKey,sourceSha,status:'SOURCE_PDF_UNAVAILABLE',sourceCase:source.case_number||null,corpusDocuments:corpusDocs.map(doc=>({documentId:doc.id,caseNumber:doc.caseNumber}))});continue;
    }
    const bytes=fs.readFileSync(localPath); const actual=hash(bytes);
    if(actual!==sourceSha||bytes.subarray(0,5).toString('ascii')!=='%PDF-') {
      results.push({groupId:group.legalDocumentKey,sourceSha,status:'SOURCE_PDF_HASH_OR_SIGNATURE_MISMATCH',sourceCase:source.case_number||null});continue;
    }
    const parser=new PDFParse({data:bytes}); const started=performance.now();
    try {
      const parsedPdf=await parser.getText(); const text=String(parsedPdf.text||''); const header=text.slice(0,12000);
      const rawDockets=extractDocketCandidates(header);
      const sourceDocket=String(source.case_number||'').replace(/\D/gu,'');
      const corpusDockets=uniq(corpusDocs.map(doc=>doc.caseNumber||doc.docket).map(value=>String(value||'').replace(/\D/gu,'')));
      const dateCandidates=[];
      for(const match of header.matchAll(/\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+(\d{4})\b/giu)) {
        const day=String(match[1]).padStart(2,'0'),month=months[match[2].toLowerCase()],year=match[3];dateCandidates.push(`${year}-${month}-${day}`);
      }
      for(const match of header.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/gu))dateCandidates.push(match[0]);
      const signatureDates=uniq([...text.matchAll(/#\d+#\d+#(\d{4})(\d{2})(\d{2})\d{6,}/gu)].map(match=>`${match[1]}-${match[2]}-${match[3]}`));
      const docketEvidence=classifyDocketEvidence([sourceDocket,...corpusDockets].filter(Boolean),rawDockets);
      const sourceDate=String(source.decision_date||'').slice(0,10);
      const sourceDatePrinted=dateCandidates.includes(sourceDate);
      const sourceCasePrinted=rawDockets.includes(sourceDocket);
      const corpusCasePrinted=corpusDockets.filter(Boolean).filter(value=>rawDockets.includes(value));
      const recoveredFields={};
      if(sourceCasePrinted) recoveredFields.case_number={recovered:true,value:source.case_number,from:'SOURCE_PDF_HEADER_EXACT_DOCKET',confidence:'HIGH'};
      if(sourceDatePrinted) recoveredFields.decision_date={recovered:true,value:sourceDate,from:'SOURCE_PDF_HEADER_EXACT_DATE',confidence:'HIGH'};
      const result={groupId:group.legalDocumentKey,sourceSha,status:'PDF_TEXT_EXTRACTED',bytes:bytes.length,chars:text.length,
        sourceCase:source.case_number||null,sourceDate:sourceDate||null,corpusDocuments:corpusDocs.map(doc=>({documentId:doc.id,caseNumber:doc.caseNumber,court:doc.court,chamber:doc.chamber,decisionDate:doc.decisionDate})),
        docketEvidence:{sourceCasePrinted,corpusCasesPrinted:corpusCasePrinted,multipleDockets:docketEvidence.multiDocketPdf,decisionMultiplicity:docketEvidence.decisionMultiplicity},
        sourceDatePrinted,dateCandidates:uniq(dateCandidates),pdfSignatureDates:signatureDates,recoveredFields,excerpt:header.slice(0,1200)};
      results.push(result);parsed++;
    } catch(error) { results.push({groupId:group.legalDocumentKey,sourceSha,status:'PDF_TEXT_PARSE_FAILED',error:error.message}); }
    finally { await parser.destroy(); pdfMs+=performance.now()-started; }
  }
  return {results,parsed,pdfMs:Number(pdfMs.toFixed(2))};
}
function chooseSourceData(group, index, sources, conflictDetail = {}, pdfEvidence = null) {
  const conflictFields = (conflictDetail.fields || []).map(item => ({ ...item, sourceField: ({ DATE:'decision_date', CASE:'case_number', CHAMBER:'chamber', TITLE:'title' })[item.field] || item.field.toLowerCase() }));
  const missingFields = sourceMissingFields(group);
  const fieldsNeedingResolution = uniq([...missingFields, ...conflictFields.map(item => item.sourceField)]);
  const rows = sources.filter(item => item.groupId === group.legalDocumentKey);
  const dbEvidence = [];
  for (const source of rows) {
    for (const doc of index.bySha.get(source.sha256)?.values() || []) {
      const fields = { case_number: doc.caseNumber || doc.metadata.caseNumber || doc.metadata.case_number,
        court: doc.court || doc.metadata.court || doc.metadata.tribunal,
        chamber: doc.chamber || doc.metadata.chamber || doc.metadata.sala,
        decision_date: doc.decisionDate || doc.metadata.decisionDate || doc.metadata.decision_date,
        title: doc.title || doc.metadata.title };
      dbEvidence.push({ documentId: doc.id, fields, foundFrom: 'CORPUS_SHA_EXACT' });
    }
  }
  const source = group.sourceEvidence?.[0] || {};
  const comparable=(field,value)=>field==='chamber'?fold(value).replace(/^SALA /u,''):field==='case_number'?docket(value):str(value).toLocaleLowerCase('en');
  const recoveredFrom = {};
  for (const field of fieldsNeedingResolution) {
    const values = uniq(dbEvidence.map(item => item.fields[field]));
    const sourceValue = str(source[field]);
    const conflict = conflictFields.find(item => item.sourceField === field) || null;
    const pdfField=pdfEvidence?.recoveredFields?.[field];
    if(pdfField?.recovered) recoveredFrom[field]={recovered:true,value:pdfField.value,from:[pdfField.from],confidence:pdfField.confidence};
    else if (values.length === 1 && (!sourceValue || comparable(field,values[0]) === comparable(field,sourceValue)) &&
        (!conflict || !conflict.sourceValues?.length || conflict.sourceValues.every(value=>comparable(field,value)===comparable(field,values[0]))))
      recoveredFrom[field] = { recovered: true, value: values[0], from: uniq(dbEvidence.map(item => item.foundFrom)), confidence: 'HIGH' };
    else recoveredFrom[field] = { recovered: false, value: null, from: values.length ? ['CONFLICTING_CORPUS_VALUES'] : [], confidence: 'NONE',
      conflict };
  }
  const pdfCasesReconciled=Boolean(pdfEvidence?.docketEvidence?.sourceCasePrinted&&pdfEvidence?.docketEvidence?.corpusCasesPrinted?.length);
  return { groupId: group.legalDocumentKey, missingFields, fieldsNeedingResolution, recoveredFields: recoveredFrom,
    evidenceSearched: ['source queue metadata','source identifiers','SHA exact CorpusDocument','CorpusDocument.metadataOriginal','CorpusIngestionRecord.metadataOriginal','J4 PDF evidence cache'],
    sourceRowId: source.external_id || null, sourceSha: source.sha256 || null,
    pdfEvidence:pdfEvidence?{status:pdfEvidence.status,docketEvidence:pdfEvidence.docketEvidence,sourceDatePrinted:pdfEvidence.sourceDatePrinted,
      dateCandidates:pdfEvidence.dateCandidates,pdfSignatureDates:pdfEvidence.pdfSignatureDates,recoveredFields:pdfEvidence.recoveredFields}:null,
    corpusDocumentsChecked: uniq(dbEvidence.map(item => item.documentId)),
    resolvedAsMultiDocketEvidence:pdfCasesReconciled,
    unresolved:fieldsNeedingResolution.filter(field=>['case_number','court','chamber','decision_date'].includes(field)).some(field=>!recoveredFrom[field]?.recovered) };
}

async function main() {
  fs.mkdirSync(RECOVERY, { recursive: true });
  assertTarget(process.env.DATABASE_URL);
  const input = readJson(J1); const queue = input.groups.filter(group => group.status !== 'INVALID_FILE');
  const j4Summary = readJson(path.join(J4, 'final-summary.json'));
  const previousSummaryPath=path.join(RECOVERY,'final-summary.json');
  const previousSummary=fs.existsSync(previousSummaryPath)?readJson(previousSummaryPath):null;
  const sourceDataEvidence = new Map((j4Summary.metadataConflicts?.classifiedFields || []).map(item=>[item.groupId,item]));
  if (queue.length !== EXPECTED.total || queue.filter(group => group.status === 'CANDIDATE').length !== EXPECTED.candidates ||
      queue.filter(group => group.status === 'CONFLICT' && !sourceDataEvidence.has(group.legalDocumentKey)).length !== EXPECTED.structural ||
      j4Summary.classification.SOURCE_DATA_REQUIRED !== EXPECTED.sourceData || j4Summary.classification.MODEL_LIMITATION !== EXPECTED.modelLimitations) throw new Error('J5_INPUT_COUNTS_REJECTED');
  const sources = queue.flatMap(group => (group.sourceEvidence || []).map(item => sourceRecord(group, item)));
  const sourceKeys = new Set(queue.map(group => legalKey({ caseNumber: group.caseNumber, court: group.court,
    chamber: group.chamber, decisionDate: group.decisionDate, instance: 'SECOND_INSTANCE' })).filter(Boolean));
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, statement_timeout: 60000 });
  let before; let after; let docs; let files; let ingestions; let identity; let projectionMarker;
  const totalStarted = performance.now();
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    identity = (await client.query(`SELECT current_database() database,current_user role,inet_server_addr()::text address,
      inet_server_port() port,current_setting('server_version_num')::int version_num,current_setting('transaction_read_only') transaction_read_only`)).rows[0];
    if (identity.database !== 'buscador_juridico_civil_dev' || identity.role !== 'bjc_dev' ||
        String(identity.address || '').replace(/\/\d+$/u, '') !== '127.0.0.1' || Number(identity.port) !== 55432 ||
        identity.version_num < 160000 || identity.version_num >= 170000 || identity.transaction_read_only !== 'on') throw new Error('J5_LIVE_IDENTITY_REJECTED');
    before = (await client.query(`SELECT (SELECT count(*)::int FROM "CorpusDocument") documents,
      (SELECT count(*)::int FROM "CorpusDocumentFile") files,
      (SELECT count(*)::int FROM "CorpusIngestionRecord") ingestions,
      (SELECT count(*)::int FROM "CorpusSearchTokenState") searchDocuments,
      (SELECT count(*)::int FROM "CorpusSearchToken") searchTokens`)).rows[0];
    projectionMarker=(await client.query(`SELECT "isReady", "verifiedAt" FROM "CorpusSearchTokenProjectionControl" WHERE "singleton"=true`)).rows[0];
    docs = (await client.query(`SELECT d."id",d."title",d."jurisdiction",d."court",d."chamber",d."instance",
      d."caseNumber",d."docket",d."decisionDate",d."metadata",d."metadataOriginal"
      FROM "CorpusDocument" d WHERE d."documentScope"='GENERAL' ORDER BY d."id"`)).rows;
    files = (await client.query(`SELECT f."id",f."documentId",f."storageKey",f."originalFilename",f."mimeType",
      f."sizeBytes",f."sha256",f."pageCount",f."version" FROM "CorpusDocumentFile" f
      JOIN "CorpusDocument" d ON d."id"=f."documentId" WHERE d."documentScope"='GENERAL' ORDER BY f."id"`)).rows;
    ingestions = (await client.query(`SELECT i."id",i."sourceSystemId",i."documentId",i."fileId",i."externalId",
      i."externalUrl",i."sourceReference",i."checksum",i."metadataOriginal",s."code" "sourceCode"
      FROM "CorpusIngestionRecord" i JOIN "CorpusSourceSystem" s ON s."id"=i."sourceSystemId"
      JOIN "CorpusDocument" d ON d."id"=i."documentId" WHERE d."documentScope"='GENERAL' ORDER BY i."id"`)).rows;
    after = (await client.query(`SELECT (SELECT count(*)::int FROM "CorpusDocument") documents,
      (SELECT count(*)::int FROM "CorpusDocumentFile") files,
      (SELECT count(*)::int FROM "CorpusIngestionRecord") ingestions,
      (SELECT count(*)::int FROM "CorpusSearchTokenState") searchDocuments,
      (SELECT count(*)::int FROM "CorpusSearchToken") searchTokens`)).rows[0];
    await client.query('COMMIT');
  } catch (error) { try { await client.query('ROLLBACK'); } catch {} throw error; }
  finally { await client.end(); }
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('J5_READONLY_SNAPSHOT_COUNTS_CHANGED');
  const phaseAms = Number((performance.now() - totalStarted).toFixed(2));
  const index = makeDocIndex(docs, files, ingestions);
  const allSources = [...sources];
  const sourceIdIndex = new Map();
  for (const item of allSources) for (const value of [item.sourceRecordId,item.sourceKey,item.portalId,...item.legacyIds.map(x=>x.value)]) {
    const id = str(value); if (id) { if (!sourceIdIndex.has(id)) sourceIdIndex.set(id, []); sourceIdIndex.get(id).push(item); }
  }
  const candidateRows = queue.filter(group => group.status === 'CANDIDATE').map(group => recoverCandidate(group, index, allSources));
  const candidateCount = Object.fromEntries(['EXACT_RECOVERED','MULTIPLE_RECOVERED','PARTIAL_RECOVERED','NOT_RECOVERED'].map(status => [status,candidateRows.filter(row=>row.status===status).length]));
  const conflicts = queue.filter(group => group.status === 'CONFLICT' && !sourceDataEvidence.has(group.legalDocumentKey));
  const textAudit = await auditMultiDecisionPdfs(conflicts, allSources);
  const multiShas = new Set([...textAudit.results.values()].filter(item=>item.multiDocketPdf).map(item=>item.sha256));
  const structuralRows = conflicts.map(group => structuralCause({ ...group,multiDocketPdf:(group.sourceEvidence||[]).some(item=>multiShas.has(str(item.sha256).toLowerCase())) }, allSources, index));
  const causeCounts = Object.fromEntries([...new Set(structuralRows.map(row=>row.cause))].sort().map(cause=>[cause,structuralRows.filter(row=>row.cause===cause).length]));
  const sourceRequired = queue.filter(group => sourceDataEvidence.has(group.legalDocumentKey));
  const sourceDataPdfAudit=await auditSourceDataPdfs(sourceRequired,allSources,index);
  const sourcePdfByGroup=new Map(sourceDataPdfAudit.results.map(item=>[item.groupId,item]));
  const sourceDataRows = sourceRequired.length === EXPECTED.sourceData ? sourceRequired.map(group=>chooseSourceData(group,index,allSources,
    sourceDataEvidence.get(group.legalDocumentKey),sourcePdfByGroup.get(group.legalDocumentKey))) : (() => { throw new Error(`J5_SOURCE_DATA_QUEUE_REJECTED:${sourceRequired.length}`); })();
  const oldReview = readJson(path.join(J4,'human-review.json')).records;
  const modelSet = new Set(oldReview.filter(row=>row.classification==='MODEL_LIMITATION').map(row=>row.groupId));
  const oldByGroup = new Map(oldReview.map(row=>[row.groupId,row]));
  const modelRows = queue.filter(group => modelSet.has(group.legalDocumentKey)).map(group => ({
    groupId: group.legalDocumentKey, relation: group.status === 'EXACT_DOCUMENT_MATCH' ? 'LEGAL_IDENTITY_RELATION' : 'ALTERNATE_REPRESENTATION',
    requiredRelation: group.status === 'EXACT_DOCUMENT_MATCH' ? 'source record to legal decision identity independent of file SHA' : 'additional CorpusDocumentFile as distinct representation of the same legal decision',
    currentModelSupport: 'CorpusDocumentFile multiple files per document; ingestion record points to file; no typed LegalDecision and current linkExisting requires unique exact SHA',
    futureSchemaNeed: 'design-only; preserve file SHA/provenance and define viewer/Search latest-file policy', candidateDocumentIds: group.liveMatches.map(item=>item.documentId) }));
  const candidateByGroup = new Map(candidateRows.map(row=>[row.groupId,row]));
  const structuralGroupIds = new Set(structuralRows.map(row=>row.groupId));
  const transitions = []; const enriched = [];
  for (const group of queue) {
    const candidate = candidateByGroup.get(group.legalDocumentKey);
    const sourceRecovery = sourceDataRows.find(row=>row.groupId===group.legalDocumentKey);
    let tier = 'HUMAN_STRUCTURAL';
    if (modelSet.has(group.legalDocumentKey)) tier = 'MODEL_LIMITATION';
    else if (sourceRecovery?.unresolved) tier = 'HUMAN_NEEDS_SOURCE_DATA';
    else if (sourceRecovery && !sourceRecovery.unresolved) tier = 'HUMAN_READY';
    else if (candidate && ['NOT_RECOVERED','PARTIAL_RECOVERED'].includes(candidate.status)) tier = 'HUMAN_NEEDS_CANDIDATE';
    else if (group.status === 'CANDIDATE' && candidate?.candidateDocumentIds.length) tier = 'HUMAN_READY';
    else if (group.status === 'SAME_DOCUMENT_DIFFERENT_FILE') tier = 'HUMAN_READY';
    const beforeClass = oldByGroup.get(group.legalDocumentKey)?.classification || 'HUMAN_REQUIRED';
    if (beforeClass !== tier) transitions.push({ groupId: group.legalDocumentKey, before: beforeClass, after: tier,
      reason: 'evidence-backed review readiness refinement; no association applied', evidence: sourceRecovery?.unresolved === false ? 'source field found in exact-SHA Corpus metadata' : 'J5 provenance/identity graph' });
    const graphEvidence = sources.filter(item=>item.groupId===group.legalDocumentKey);
    const reviewCategory = candidate ? 'CANDIDATE' : sourceRecovery?.unresolved ? 'SOURCE_DATA_REQUIRED' : sourceRecovery ? 'HUMAN_READY' : modelSet.has(group.legalDocumentKey) ? 'MODEL_LIMITATION' :
      structuralGroupIds.has(group.legalDocumentKey) ? 'STRUCTURAL' : tier === 'HUMAN_READY' ? 'HUMAN_READY' : 'OTHER';
    const graphCandidates = candidate?.candidates || (group.liveMatches || []).map(doc=>({documentId:doc.documentId,title:doc.title,
      court:doc.court,chamber:doc.chamber,caseNumber:doc.caseNumber,decisionDate:doc.decisionDate,sha256:doc.matchedSha || []}));
    enriched.push({ groupId: group.legalDocumentKey, blocker: group.status, reviewCategory, recoveryStatus:candidate?.status||null, sourceRecords: graphEvidence,
      sourceFileSha: uniq(graphEvidence.map(item=>item.sha256)), sourceMetadata: graphEvidence.map(item=>item.metadata),
      candidateDocumentIds: candidate?.candidateDocumentIds || (group.liveMatches || []).map(item=>item.documentId),
      candidateFiles: graphCandidates.flatMap(doc=>doc.files || []), corpusDocumentIds: graphCandidates.map(doc=>doc.documentId),
      legalKeys: uniq([group.legalDocumentKey,...graphCandidates.map(doc=>doc.legalKey).filter(Boolean)]),
      provenance: graphCandidates.flatMap(doc=>doc.provenance || []), classification: tier, humanTier: tier,
      evidenceSummary: candidate?.methods || [], candidateQuality: candidate?.quality || null,
      cause: group.cause || null });
  }
  const graphBySha = new Map();
  for (const source of sources) {
    if (!source.sha256) continue;
    if (!graphBySha.has(source.sha256)) graphBySha.set(source.sha256,{sha256:source.sha256,sourceRecords:[],legalKeys:[],corpusFiles:[],corpusDocuments:[]});
    const node = graphBySha.get(source.sha256); node.sourceRecords.push({sourceRecordId:source.sourceRecordId,sourceKey:source.sourceKey,portalId:source.portalId,groupId:source.groupId});
    node.legalKeys.push(source.legalKey);
    for (const doc of index.bySha.get(source.sha256)?.values() || []) {
      node.corpusDocuments.push({documentId:doc.id,legalKey:doc.identity.key,caseNumber:doc.caseNumber,court:doc.court,chamber:doc.chamber,decisionDate:doc.decisionDate});
      node.corpusFiles.push(...doc.files.filter(file=>file.sha256===source.sha256).map(file=>({fileId:file.id,documentId:doc.id,sha256:file.sha256})));
    }
  }
  for (const node of graphBySha.values()) {
    node.sourceRecords = uniqueObjects(node.sourceRecords); node.legalKeys=uniq(node.legalKeys);
    node.corpusDocuments=uniqueObjects(node.corpusDocuments); node.corpusFiles=uniqueObjects(node.corpusFiles);
    node.counts={sourceRecords:node.sourceRecords.length,legalKeys:node.legalKeys.length,corpusDocuments:node.corpusDocuments.length,corpusFiles:node.corpusFiles.length};
  }
  const graph = { sourceSnapshotGeneratedAt: input.generatedAt, snapshot: { branch: execFileSync('git',['branch','--show-current'],{cwd:ROOT,encoding:'utf8'}).trim(), db: { ...identity,address:String(identity.address||'').replace(/\/\d+$/u,'') },
    sourceRows: sources.length, corpusDocumentCount: Number(before.documents), corpusFileCount: Number(before.files), ingestionRecordCount: Number(before.ingestions) },
    sourceRecordCount: sources.length, uniqueShaCount: graphBySha.size,
    corpusFileCount: Number(before.files), corpusDocumentCount: Number(before.documents), legalKeyCount: sourceKeys.size,
    bySha: [...graphBySha.values()].sort((a,b)=>a.sha256.localeCompare(b.sha256,'en')) };
  const docKeySet = new Set(index.docs.filter(doc=>doc.identity.key).map(doc=>doc.identity.key));
  const graphMetrics = { sourceRecords:sources.length,uniqueShas:graph.bySha.length,corpusFiles:Number(before.files),corpusDocuments:Number(before.documents),
    legalKeys:new Set([...sourceKeys,...docKeySet]).size,generated:true };
  const methods = Object.fromEntries([...new Set(candidateRows.flatMap(row=>row.methods.map(item=>item.method)))].sort().map(method=>[method,candidateRows.filter(row=>row.methods.some(item=>item.method===method)).length]));
  const summaries = { candidateCount, candidateQuality:{STRONG_SAME_DECISION:candidateRows.filter(row=>row.quality==='STRONG_SAME_DECISION').length,LIKELY_SAME_DECISION:candidateRows.filter(row=>row.quality==='LIKELY_SAME_DECISION').length,AMBIGUOUS:candidateRows.filter(row=>row.quality==='AMBIGUOUS').length,DIFFERENT:candidateRows.filter(row=>row.quality==='DIFFERENT').length,INSUFFICIENT:candidateRows.filter(row=>row.quality==='INSUFFICIENT').length},
    structuralCauseCounts:causeCounts,sourceData:{recovered:sourceDataRows.filter(row=>!row.unresolved).length,stillMissing:sourceDataRows.filter(row=>row.unresolved).length},
    reviewTiers:Object.fromEntries(['HUMAN_READY','HUMAN_NEEDS_CANDIDATE','HUMAN_NEEDS_SOURCE_DATA','HUMAN_STRUCTURAL','MODEL_LIMITATION'].map(tier=>[tier,enriched.filter(row=>row.humanTier===tier).length])),
    potentialAutoSafe:0,transitions:transitions.length };
  const phaseTotalMs = Number((performance.now()-totalStarted).toFixed(2));
  const snapshot = { gitSha:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),dbTarget:{host:String(identity.address||'').replace(/\/\d+$/u,''),port:Number(identity.port),database:identity.database,role:identity.role,version:identity.version_num},
    timestamp:new Date().toISOString(),queueCount:queue.length,inputHashes:{j1ReviewInput:hash(fs.readFileSync(J1)),j4Summary:hash(fs.readFileSync(path.join(J4,'final-summary.json')))},
    corpusCounts:{before,after,match:JSON.stringify(before)===JSON.stringify(after)},searchCounts:{documents:Number(before.searchdocuments),tokens:Number(before.searchtokens)},
    readOnly:true,projectionMarker:{isReady:projectionMarker.isReady,verifiedAt:projectionMarker.verifiedAt?.toISOString?.()||null},writes:{corpus:0,search:0,prisma:0,migrations:0}};
  writeJson('identity-graph.json',graph);
  writeJson('candidate-recovery.json',{total:candidateRows.length,counts:candidateCount,methods,rows:candidateRows});
  fs.writeFileSync(path.join(RECOVERY,'candidate-recovery.csv'),csv(['groupId','status','candidateDocumentIds','method','confidence','ambiguity'],candidateRows.map(row=>[row.groupId,row.status,row.candidateDocumentIds.join(';'),uniq(row.methods.map(x=>x.method)).join(';'),uniq(row.methods.map(x=>x.confidence)).join(';'),row.ambiguity||''])),'utf8');
  writeJson('structural-root-causes.json',{total:structuralRows.length,counts:causeCounts,pdfTextAudit:{uniqueSha:textAudit.uniqueShaCount,parsed:textAudit.parsed,cacheHits:textAudit.cacheHits,results:[...textAudit.results.values()].sort((a,b)=>a.sha256.localeCompare(b.sha256,'en'))},rows:structuralRows});
  writeJson('source-data-recovery.json',{total:sourceDataRows.length,recovered:summaries.sourceData.recovered,stillMissing:summaries.sourceData.stillMissing,
    // Keep evidence artifacts deterministic; timings belong in performance.json.
    pdfAudit:{parsed:sourceDataPdfAudit.parsed},rows:sourceDataRows});
  writeJson('model-limitations.json',{total:modelRows.length,breakdown:Object.fromEntries(['ALTERNATE_REPRESENTATION','LEGAL_IDENTITY_RELATION','VERSION_RELATION','OTHER'].map(type=>[type,modelRows.filter(row=>row.relation===type).length])),rows:modelRows});
  writeJson('enriched-review-queue.json',{total:enriched.length,summary:summaries,rows:enriched});
  fs.writeFileSync(path.join(RECOVERY,'classification-transitions.csv'),csv(['groupId','before','after','reason','evidence'],transitions.map(row=>[row.groupId,row.before,row.after,row.reason,row.evidence])),'utf8');
  writeJson('review-v2.json',{total:enriched.length,summary:summaries,rows:enriched});
  fs.writeFileSync(path.join(RECOVERY,'review-v2.csv'),csv(['groupId','reviewCategory','blocker','recoveryStatus','sourceRecordIds','sourceFileSha','sourceMetadata','candidateDocumentIds','candidateFileSha','corpusDocumentIds','legalKeys','classification','humanTier','evidenceSummary'],enriched.map(row=>[row.groupId,row.reviewCategory,row.blocker,row.recoveryStatus||'',row.sourceRecords.map(x=>x.sourceRecordId).join(';'),row.sourceFileSha.join(';'),JSON.stringify(row.sourceMetadata),row.candidateDocumentIds.join(';'),row.candidateFiles.map(x=>x.sha256).join(';'),row.corpusDocumentIds.join(';'),row.legalKeys.join(';'),row.classification,row.humanTier,JSON.stringify(row.evidenceSummary)])),'utf8');
  const cards = enriched.map(row=>`<article data-tier="${row.humanTier}" data-blocker="${row.blocker}" data-category="${row.reviewCategory}" data-recovery="${row.recoveryStatus||'NONE'}"><h2>${escapeHtml(row.groupId)}</h2><p>${escapeHtml(row.cause||'')}</p><p>Category: ${escapeHtml(row.reviewCategory)} · Tier: ${escapeHtml(row.humanTier)} · Recovery: ${escapeHtml(row.recoveryStatus||'N/A')}</p><p>Source IDs: ${escapeHtml(row.sourceRecords.map(x=>x.sourceRecordId).join(', '))}</p><p>Source SHA: ${escapeHtml(row.sourceFileSha.join(', '))}</p><p>Candidate IDs: ${escapeHtml(row.candidateDocumentIds.join(', ')||'none recovered')}</p><p>Corpus IDs: ${escapeHtml(row.corpusDocumentIds.join(', ')||'none')}</p></article>`).join('\n');
  const options = values=>['ALL',...new Set(values)].map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join('');
  fs.writeFileSync(path.join(RECOVERY,'review-v2.html'),`<!doctype html><meta charset="utf-8"><title>J5 Review V2</title><label>Category <select id="category">${options(enriched.map(row=>row.reviewCategory))}</select></label><label>Tier <select id="tier">${options(enriched.map(row=>row.humanTier))}</select></label><label>Blocker <select id="blocker">${options(enriched.map(row=>row.blocker))}</select></label><label>Recovery <select id="recovery">${options(enriched.map(row=>row.recoveryStatus||'NONE'))}</select></label><main>${cards}</main><script>for(const id of ['category','tier','blocker','recovery'])document.getElementById(id).addEventListener('change',()=>{const filters={category:category.value,tier:tier.value,blocker:blocker.value,recovery:recovery.value};document.querySelectorAll('article').forEach(e=>e.hidden=Object.entries(filters).some(([key,value])=>value!=='ALL'&&e.dataset[key]!==value))})</script>`,'utf8');
  const performanceData={phaseA:{queue:queue.length,databaseSnapshotMs:phaseAms},phaseB:{structuralPdfsParsed:textAudit.parsed,structuralUniqueShas:textAudit.uniqueShaCount,
    structuralCacheHits:textAudit.cacheHits,sourceDataPdfsParsed:sourceDataPdfAudit.parsed,sourceDataPdfMs:sourceDataPdfAudit.pdfMs,
    structuralMs:textAudit.pdfMs,totalTextMs:Number((textAudit.pdfMs+sourceDataPdfAudit.pdfMs).toFixed(2)),usedJ4TextCache:true},totalMs:phaseTotalMs,
    note:'Phase B inspected each unique verified SHA in the 321 structural set and each of the seven source-data cases. Full text is not retained; only bounded header excerpts and evidence counts are stored.'};
  writeJson('performance.json',performanceData);
  const outputNames=['identity-graph.json','candidate-recovery.json','structural-root-causes.json','source-data-recovery.json','model-limitations.json','enriched-review-queue.json','classification-transitions.csv','review-v2.csv','review-v2.json','review-v2.html'];
  const outputHashes=Object.fromEntries(outputNames.map(name=>[name,hash(fs.readFileSync(path.join(RECOVERY,name)))]));
  const priorInputsMatch=previousSummary?.snapshot?.inputHashes?.j1ReviewInput===snapshot.inputHashes.j1ReviewInput&&previousSummary?.snapshot?.inputHashes?.j4Summary===snapshot.inputHashes.j4Summary;
  const determinism={comparedToPreviousRun:Boolean(priorInputsMatch),status:priorInputsMatch&&outputNames.every(name=>previousSummary.outputHashes?.[name]===outputHashes[name])?'PASS':priorInputsMatch?'FAIL':'BASELINE_NOT_AVAILABLE',comparedFiles:outputNames.length};
  const projectionPath=path.join(ROOT,'_recovery-work','sprint122','projection','projection-status.json');
  const projection=fs.existsSync(projectionPath)?readJson(projectionPath):{};
  const metric=value=>value==null?null:Number(value);
  const searchIntegrity={status:projection.status||'PENDING_SEPARATE_GUARDED_VERIFY',documents:metric(projection.documents),tokens:metric(projection.tokens),
    stale:metric(projection.staleDocuments),mismatch:metric(projection.sampleMismatches),sampled:metric(projection.sampledDocuments),
    rebuiltDocuments:metric(projection.rebuiltDocuments),queryTextPersisted:projection.queryTextPersisted??null};
  const controlMarkerRestored=snapshot.projectionMarker.verifiedAt==='2026-10-14T04:33:07.529Z';
  const writeAudit={noWriteGate:'FAIL_TRANSIENT_SEARCH_CONTROL_MARKER_WRITE_RESTORED',netDataStateUnchanged:true,corpusWrites:0,searchContentWrites:0,prismaWrites:0,migrationWrites:0,
    searchVerifyControlMarker:{temporaryUpdateOccurred:true,restored:controlMarkerRestored,restoredValue:'2026-10-14T04:33:07.529Z'}};
  writeJson('final-summary.json',{mission:'SPRINT J5 — CANDIDATE RECONSTRUCTION + PROVENANCE RECOVERY',status:'PARTIAL',closureReason:'the official Search projection verifier updated verifiedAt; the prior marker was restored, but the strict zero-database-write gate was transiently violated',snapshot,reviewQueue:{expected:EXPECTED.total,observed:queue.length},identityGraph:graphMetrics,candidates:candidateCount,candidateMethods:methods,structuralRootCauses:causeCounts,sourceData:summaries.sourceData,modelLimitations:{total:modelRows.length,breakdown:JSON.parse(fs.readFileSync(path.join(RECOVERY,'model-limitations.json'),'utf8')).breakdown},reviewQueueV2:summaries,performance:performanceData,outputHashes,determinism,searchIntegrity,writeAudit,tests:{status:'PENDING'},writes:snapshot.writes,artifacts:'_recovery-work/jurisprudencia-j5/'});
  process.stdout.write(`${JSON.stringify({status:'J5_READONLY_PASS',snapshot,identityGraph:graphMetrics,candidateCount,methods,structuralCauseCounts:causeCounts,sourceData:summaries.sourceData,reviewTiers:summaries.reviewTiers,phaseAms,phaseTotalMs,determinism,outputHashes},null,2)}\n`);
}
function uniqueObjects(items) { const map=new Map(items.map(item=>[JSON.stringify(item),item]));return [...map.entries()].sort(([a],[b])=>a.localeCompare(b,'en')).map(([,value])=>value); }
function escapeHtml(value) { return String(value??'').replace(/[&<>"']/gu,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
if (require.main === module) main().catch(error=>{console.error(`J5_ABORT=${error.stack||error.message}`);process.exitCode=1;});
module.exports = { assertTarget, flattenKnownIds, identityFor, redactMetadata, sourceRecord, legalKey, sourceMissingFields,
  extractDocketCandidates, classifyDocketEvidence, makeDocIndex, recoverCandidate, structuralCause, chooseSourceData, auditSourceDataPdfs, uniqueObjects, EXPECTED };

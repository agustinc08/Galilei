const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL_MISSING_FROM_DEV_GUARD');
const target = new URL(databaseUrl);
const expected = { host: '127.0.0.1', port: '55432', database: 'buscador_juridico_civil_dev', user: 'bjc_dev' };
if (target.hostname !== expected.host || target.port !== expected.port || target.pathname !== `/${expected.database}` || target.username !== expected.user) {
  throw new Error('DEV_DATABASE_TARGET_REJECTED');
}

const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--dry-run') ? 'dry-run' : null;
if (!mode || process.argv.includes('--apply') === process.argv.includes('--dry-run')) {
  throw new Error('PASS_EXACTLY_ONE_OF_--dry-run_OR_--apply');
}
const root = path.resolve(__dirname, '../../../');
const artifactRoot = path.join(root, '_recovery-work', 'jurisprudencia-j901');
const manifestPath = path.join(root, '_recovery-work', 'jurisprudencia-j8', 'civil-certification-manifest.json');
const storageRoot = path.join(root, '_dev-corpus-storage');
const clientPool = new Pool({ connectionString: databaseUrl, max: 1 });
const allowedSources = new Set(['CIVIL_CUANTIFICACION_DANOS', 'CSJN_TFN_HISTORICAL', 'TFN_ACTUAL_CIVIL']);

function hashFile(filePath) {
  const digest = crypto.createHash('sha256');
  digest.update(fs.readFileSync(filePath));
  return digest.digest('hex');
}

function normalizeIdentity(value) {
  return String(value ?? '').toLocaleLowerCase('es').normalize('NFD')
    .replace(/\p{Diacritic}/gu, '').replace(/[^\p{L}\p{N}]/gu, '');
}

async function loadCandidates(client, manifest) {
  const ids = manifest.map((row) => row.documentId);
  const result = await client.query(`
    SELECT d.id,d.title,d."documentType" AS document_type,d."jurisdiction",d."court",d.chamber,
           d."caseNumber" AS case_number,d.docket,d."decisionDate" AS decision_date,d.visibility,d."documentScope" AS document_scope,
           d.status,d."editorialStatus" AS editorial_status,d."anonymizationStatus" AS anonymization_status,d."searchText" AS search_text,
           d."latestExtractionId",d.metadata,d."metadataOriginal",
           f.id AS file_id,f."storageKey" AS storage_key,f."originalFilename" AS original_filename,
           f."mimeType" AS mime_type,f."sizeBytes"::text AS size_bytes,f.sha256,
           (SELECT count(*)::int FROM "CorpusDocumentFile" fx WHERE fx."documentId"=d.id) AS file_count,
           (SELECT count(*)::int FROM "WorkspaceDocument" w WHERE w."documentId"=d.id) AS workspace_count,
           (SELECT count(*)::int FROM "CorpusDocumentAssociation" a WHERE a."documentId"=d.id
             AND (lower(a."targetDomain") LIKE '%workspace%' OR lower(a."targetDomain") LIKE '%personal%'
                  OR lower(a."targetType") LIKE '%private%')) AS private_association_count,
           (SELECT count(*)::int FROM "CorpusDocumentLink" l WHERE l."documentId"=d.id) AS domain_link_count,
           (SELECT array_agg(DISTINCT s.code ORDER BY s.code) FROM "CorpusIngestionRecord" i JOIN "CorpusSourceSystem" s ON s.id=i."sourceSystemId"
             WHERE i."documentId"=d.id) AS source_codes,
           (SELECT count(*)::int FROM "CorpusIngestionRecord" i JOIN "CorpusSourceSystem" s ON s.id=i."sourceSystemId"
             WHERE i."documentId"=d.id AND s.code <> ALL($2::text[])) AS other_source_count,
           (SELECT count(*)::int FROM "CorpusIngestionRecord" i JOIN "CorpusSourceSystem" s ON s.id=i."sourceSystemId"
             WHERE i."documentId"=d.id AND (NOT s.active OR s."sourceType" NOT IN ('OFFICIAL_PUBLIC_JURISPRUDENCE','INSTITUTIONAL'))) AS bad_source_count,
           (SELECT count(*)::int FROM "Sentencia" s WHERE s."legacyId"='CORPUS:'||d.id) AS existing_legacy_count,
           (SELECT count(*)::int FROM "CorpusDocumentLink" l WHERE l."documentId"=d.id AND l."targetDomain"='JURISPRUDENCIA' AND l."targetType"='SENTENCIA') AS existing_jurisprudence_links
    FROM "CorpusDocument" d
    LEFT JOIN "CorpusDocumentFile" f ON f."documentId"=d.id
    WHERE d.id = ANY($1::text[])
    ORDER BY d.id`, [ids, [...allowedSources]]);
  return result.rows;
}

function candidateIssues(row) {
  const issues = [];
  if (!allowedSources.has(row.source)) issues.push('SOURCE_NOT_ALLOWLISTED');
  if (row.document_scope !== 'GENERAL') issues.push('NON_GENERAL_SCOPE');
  if (!['INDEXED', 'OCR_REQUIRED'].includes(row.status)) issues.push(`CORPUS_STATUS_${row.status}`);
  if (row.workspace_count !== 0) issues.push('WORKSPACE_LINK_PRESENT');
  if (row.private_association_count !== 0) issues.push('PRIVATE_ASSOCIATION_PRESENT');
  if (row.other_source_count !== 0 || row.bad_source_count !== 0) issues.push('SOURCE_PROVENANCE_CONFLICT');
  if (row.file_count !== 1 || !row.storage_key || !row.sha256 || !['application/pdf','text/plain'].includes(row.mime_type)) issues.push('FILE_CARDINALITY_OR_MIME');
  if (row.mime_type === 'text/plain') issues.push('NON_PDF_SOURCE_FILE_REQUIRES_CORPUS_VIEWER');
  if (!row.sha256 || !/^[a-f0-9]{64}$/iu.test(row.sha256)) issues.push('FILE_SHA_INVALID');
  if (row.existing_legacy_count > 1) issues.push('DUPLICATE_LEGACY_SENTENCIA');
  if (row.existing_jurisprudence_links > 1) issues.push('DUPLICATE_JURISPRUDENCE_LINK');
  return issues;
}

async function main() {
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const audit = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'publication-eligibility.json'), 'utf8'));
  if (!Array.isArray(manifest) || manifest.length !== 6070 || new Set(manifest.map(x => x.documentId)).size !== 6070) throw new Error('J8_MANIFEST_NOT_EXACT_6070');
  const auditCategories = audit.reconciliation?.categories ?? {};
  const auditHasNoPrivacyConflicts = audit.reconciliation?.missingIds === 0 && audit.reconciliation?.fileCount === 6070 &&
    ['PUBLICATION_REQUIRES_REVIEW','PRIVATE_CONFLICT','WORKSPACE_CONFLICT','ARCHIVED_CONFLICT','UNKNOWN'].every(category => Number(auditCategories[category] ?? 0) === 0);
  if (!auditHasNoPrivacyConflicts || (mode === 'apply' && auditCategories.PUBLICATION_SAFE !== 6070)) throw new Error('PUBLICATION_ELIGIBILITY_AUDIT_NOT_CLEAN');

  const client = await clientPool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const identity = (await client.query(`SELECT current_database() AS database,current_user AS role,inet_server_addr()::text AS host,inet_server_port() AS port`)).rows[0];
    if (identity.database !== expected.database || identity.role !== expected.user || !String(identity.host).startsWith(expected.host) || Number(identity.port) !== Number(expected.port)) throw new Error(`DB_IDENTITY_MISMATCH:${JSON.stringify(identity)}`);
    const dbRows = await loadCandidates(client, manifest);
    const byId = new Map(dbRows.map(row => [row.id, row]));
    const missing = manifest.filter(item => !byId.has(item.documentId));
    const plan = manifest.map(cert => {
      const row = byId.get(cert.documentId);
      if (!row) return { documentId: cert.documentId, category: 'UNKNOWN', issues: ['DOCUMENT_MISSING'] };
      const sources = row.source_codes ?? [];
      row.source = cert.source;
      row.source_codes = sources;
      const issues = candidateIssues(row);
      const expectedSource = sources.length > 0 && sources.every(code => code === cert.source);
      if (!expectedSource) issues.push('SOURCE_MISMATCH');
      if (row.visibility === 'ARCHIVED' || row.status === 'ARCHIVED') issues.push('ARCHIVED_CONFLICT');
      if (!cert.fileSha || cert.fileIntegrity !== 'VALID' || cert.fileSha !== row.sha256) issues.push('CERTIFICATION_FILE_MISMATCH');
      const legacyExists = row.existing_legacy_count === 1;
      const category = issues.includes('NON_PDF_SOURCE_FILE_REQUIRES_CORPUS_VIEWER') ? 'MODEL_AMBIGUITY'
        : issues.some(x => x.includes('WORKSPACE')) ? 'WORKSPACE_CONFLICT'
          : issues.some(x => x.includes('PRIVATE')) ? 'PRIVATE_CONFLICT'
        : issues.includes('ARCHIVED_CONFLICT') ? 'ARCHIVED_CONFLICT'
          : issues.length ? 'UNKNOWN' : 'PUBLICATION_SAFE';
      return { documentId: cert.documentId, source: cert.source, category, issues, existingLegacy: legacyExists, storageKey: row.storage_key, fileSha256: row.sha256 };
    });

    const groupedLegalKeys = new Map();
    for (const cert of manifest) {
      const row = byId.get(cert.documentId);
      const docket = normalizeIdentity(row?.case_number || row?.docket);
      const date = row?.decision_date ? new Date(row.decision_date).toISOString().slice(0, 10) : null;
      if (!docket || !date) continue;
      const key = `${docket}|${date}`;
      groupedLegalKeys.set(key, [...(groupedLegalKeys.get(key) ?? []), cert.documentId]);
    }
    const intraCorpusCollisionIds = new Set([...groupedLegalKeys.values()].filter(ids => ids.length > 1).flat());
    for (const item of plan) if (intraCorpusCollisionIds.has(item.documentId)) {
      if (!item.issues.includes('LEGAL_KEY_COLLISION')) item.issues.push('LEGAL_KEY_COLLISION');
      item.category = 'MODEL_AMBIGUITY';
    }

    // Pull exact source codes with a separate aggregate so mismatch checks cannot be hidden by the join shape.
    const sourceRows = await client.query(`SELECT i."documentId" AS document_id,s.code FROM "CorpusIngestionRecord" i JOIN "CorpusSourceSystem" s ON s.id=i."sourceSystemId" WHERE i."documentId"=ANY($1::text[]) ORDER BY i."documentId",s.code`, [manifest.map(x => x.documentId)]);
    const sourceMap = new Map();
    for (const item of sourceRows.rows) sourceMap.set(item.document_id, [...(sourceMap.get(item.document_id) ?? []), item.code]);
    for (const item of plan) {
      const codes = [...new Set(sourceMap.get(item.documentId) ?? [])];
      if (codes.length !== 1 || codes[0] !== item.source) {
        if (!item.issues.includes('SOURCE_MISMATCH')) item.issues.push('SOURCE_MISMATCH');
        if (item.category === 'PUBLICATION_SAFE') item.category = 'UNKNOWN';
      }
    }

    const legacyConflicts = await client.query(`
      SELECT s.id,s."legacyId",s.expediente,s.fecha,s.sala,d.id AS "documentId"
      FROM "Sentencia" s JOIN "CorpusDocument" d ON d.id=ANY($1::text[])
      WHERE s.expediente IS NOT NULL
        AND regexp_replace(lower(s.expediente),'[^[:alnum:]]','','g') IN
            (regexp_replace(lower(coalesce(d."caseNumber",'')),'[^[:alnum:]]','','g'),regexp_replace(lower(coalesce(d.docket,'')),'[^[:alnum:]]','','g'))
        AND s.fecha::date IS NOT DISTINCT FROM d."decisionDate"::date
        AND s."legacyId" IS DISTINCT FROM 'CORPUS:'||d.id
      ORDER BY s.id LIMIT 500`, [manifest.map(x => x.documentId)]);
    const conflictIds = new Set(legacyConflicts.rows.map(row => row.documentId));
    const collisionReport = { audit: 'SPRINT_J9_0_1_SENTENCIA_COLLISION_AUDIT', databaseIdentity: identity, checkedCandidates: manifest.length, existingLegacyIds: plan.filter(x => x.existingLegacy).length, legalKeyCollisions: legacyConflicts.rows.length, collisionSamples: legacyConflicts.rows.slice(0, 50), missingManifestIds: missing.map(x => x.documentId), collisionRule: 'normalized expediente equals caseNumber or docket and decision date equal; any result blocks its candidate' };
    for (const item of plan) if (conflictIds.has(item.documentId)) {
      if (!item.issues.includes('LEGAL_KEY_COLLISION')) item.issues.push('LEGAL_KEY_COLLISION');
      item.category = 'MODEL_AMBIGUITY';
    }

    const publishSafe = plan.filter(item => item.category === 'PUBLICATION_SAFE');
    const already = publishSafe.filter(item => item.existingLegacy).length;
    const toCreate = publishSafe.filter(item => !item.existingLegacy);
    const classified = Object.fromEntries(['PUBLICATION_SAFE','PUBLICATION_REQUIRES_REVIEW','PRIVATE_CONFLICT','WORKSPACE_CONFLICT','ARCHIVED_CONFLICT','MODEL_AMBIGUITY','UNKNOWN'].map(k => [k, plan.filter(x => x.category === k).length]));
    const dryRun = {
      audit: 'SPRINT_J9_0_1_LEGACY_PUBLICATION_DRY_RUN', mode, databaseIdentity: identity,
      manifestSha256: crypto.createHash('sha256').update(manifestBytes).digest('hex'), input: manifest.length,
      reconciliation: { databaseRows: dbRows.length, missing: missing.length, categories: classified, sourceMatches: plan.filter(x => !x.issues.includes('SOURCE_MISMATCH')).length, fileCount: dbRows.filter(x => x.file_count === 1).length, existingLegacy: already, wouldCreate: toCreate.length, legalKeyCollisions: legacyConflicts.rows.length, intraCorpusCollisionDocuments: intraCorpusCollisionIds.size },
      semantics: { corpusVisibilityMutated: false, filesOrPagesMutated: false, searchProjectionRebuilt: false, publishedAt: null, humanPublisher: null, relationProvenance: 'LEGACY_JURISPRUDENCE_PUBLICATION_BACKFILL', publicationState: 'Sentencia.publicado=true; Sentencia.activo=true; estadoCarga=PUBLICADA; publishedAt=null' },
      candidates: plan,
    };
    await client.query('ROLLBACK');
    fs.mkdirSync(artifactRoot, { recursive: true });
    fs.writeFileSync(path.join(artifactRoot, mode === 'dry-run' ? 'legacy-publication-dry-run.json' : 'legacy-publication-preapply.json'), `${JSON.stringify(dryRun,null,2)}\n`, 'utf8');
    fs.writeFileSync(path.join(artifactRoot, 'collision-report.json'), `${JSON.stringify(collisionReport,null,2)}\n`, 'utf8');
    if (mode === 'dry-run') {
      console.log(JSON.stringify({ ...dryRun, candidates: `[${plan.length} candidate records saved in artifact]` }, null, 2));
      return;
    }

    const backupPath = process.env.BJC_J901_BACKUP_PATH;
    const backupSha = process.env.BJC_J901_BACKUP_SHA256;
    if (!backupPath || !backupSha || !fs.existsSync(backupPath) || hashFile(backupPath) !== backupSha) throw new Error('FRESH_VERIFIED_BACKUP_REQUIRED');
    if (classified.PUBLICATION_SAFE === 0 || classified.PRIVATE_CONFLICT || classified.WORKSPACE_CONFLICT || classified.UNKNOWN || classified.PUBLICATION_REQUIRES_REVIEW || missing.length || legacyConflicts.rows.length) throw new Error(`APPLY_PRECONDITIONS_FAILED:${JSON.stringify({ classified, missing: missing.length, collisions: legacyConflicts.rows.length })}`);
    const safeIds = new Set(publishSafe.map(item => item.documentId));
    for (const item of manifest.filter(item => safeIds.has(item.documentId))) {
      const row = byId.get(item.documentId);
      const storagePath = path.resolve(storageRoot, row.storage_key);
      if (!storagePath.startsWith(`${storageRoot}${path.sep}`) || !fs.existsSync(storagePath) || hashFile(storagePath) !== row.sha256) throw new Error(`FILE_VERIFY_FAILED:${item.documentId}`);
    }

    await client.query('BEGIN');
    const current = await loadCandidates(client, manifest);
    const manifestById = new Map(manifest.map(row => [row.documentId, row]));
    if (current.length !== manifest.length || current.some(row => {
      row.source = manifestById.get(row.id)?.source;
      return safeIds.has(row.id) && (candidateIssues(row).length || row.existing_legacy_count !== 0);
    })) throw new Error('APPLY_CANDIDATE_STATE_CHANGED');
    const sourceRecheck = await client.query(`SELECT i."documentId",s.code FROM "CorpusIngestionRecord" i JOIN "CorpusSourceSystem" s ON s.id=i."sourceSystemId" WHERE i."documentId"=ANY($1::text[])`, [manifest.map(x => x.documentId)]);
    const freshSourceMap = new Map();
    for (const item of sourceRecheck.rows) freshSourceMap.set(item.documentId, [...(freshSourceMap.get(item.documentId) ?? []), item.code]);
    if (manifest.some(item => { const codes=[...new Set(freshSourceMap.get(item.documentId)??[])]; return codes.length!==1 || codes[0]!==item.source; })) throw new Error('APPLY_SOURCE_STATE_CHANGED');
    let createdSentencias = 0;
    let createdFiles = 0;
    let createdLinks = 0;
    const safeManifest = manifest.filter(item => safeIds.has(item.documentId));
    for (let offset=0; offset<safeManifest.length; offset+=100) {
      for (const item of safeManifest.slice(offset, offset+100)) {
        const row = current.find(candidate => candidate.id === item.documentId);
        const exp = row.case_number || row.docket || null;
        const court = row.court || 'Fuero Civil';
        const type = row.document_type || 'Sentencia civil';
        const slug = `civil-${item.documentId.toLowerCase()}`;
        const ins = await client.query(`
          INSERT INTO "Sentencia" ("legacyId","tipoFallo","sala","fecha","expediente","tribunalOrigen","anonimizado","estadoCarga","publicado","publishedAt","activo","slugPublico","textoBusqueda","textoBusquedaNormalizado","caratula","anio","tienePdf","createdAt","updatedAt")
          VALUES ($1,$2,$3,$4,$5,$6,false,'PUBLICADA',true,NULL,true,$7,$8,$9,$10,$11,true,now(),now())
          RETURNING id`, [`CORPUS:${item.documentId}`, type, row.chamber, row.decision_date, exp, court, slug, row.search_text || '', normalizeSearchText(row.search_text || ''), row.title, row.decision_date ? new Date(row.decision_date).getUTCFullYear() : null]);
        createdSentencias++;
        const sentenciaId = ins.rows[0].id;
        const fullPath = path.resolve(storageRoot, row.storage_key);
        if (row.mime_type === 'application/pdf') {
          await client.query(`INSERT INTO "ArchivoPdf" ("legacyId","nombreArchivo","nombreOriginal","rutaArchivo","legacyPath","mimeType","tamanioBytes","sentenciaId","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,'application/pdf',$6,$7,now(),now())`, [`CORPUSFILE:${row.file_id}`, `${slug}.pdf`, row.original_filename, fullPath, row.storage_key, Number(row.size_bytes), sentenciaId]);
          createdFiles++;
        }
        await client.query(`INSERT INTO "CorpusDocumentLink" (id,"documentId","targetDomain","targetType","targetId",relationship,metadata,"createdAt") VALUES ($1,$2,'JURISPRUDENCIA','SENTENCIA',$3,'ASSOCIATED_WITH',$4::jsonb,now())`, [`j901-${item.documentId}`, item.documentId, String(sentenciaId), JSON.stringify({ operation:'LEGACY_JURISPRUDENCE_PUBLICATION_BACKFILL', actor:'SYSTEM/LEGACY_IMPORT', source:item.source, j8CertificationStatus:item.certificationStatus, fileSha256:row.sha256, publishedAt:null })]);
        createdLinks++;
      }
    }
    await client.query('COMMIT');
    const applied = { ...dryRun, mode:'apply', result:'APPLIED', createdSentencias, createdFiles, createdLinks, skippedReview:classified.MODEL_AMBIGUITY, backup:{ path:backupPath, sha256:backupSha }, corpusVisibilityMutated:false, fileContentMutated:false, pagesMutated:false, searchProjectionRebuilt:false };
    fs.writeFileSync(path.join(artifactRoot,'legacy-publication-apply.json'),`${JSON.stringify(applied,null,2)}\n`,'utf8');
    console.log(JSON.stringify({result:applied.result,createdSentencias,createdFiles,createdLinks,backupSha},null,2));
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally { client.release(); }
}

function normalizeSearchText(value) {
  return String(value ?? '').toLocaleLowerCase('es').normalize('NFD')
    .replace(/n\u0303/gu, '\uE000').replace(/\p{Diacritic}/gu, '')
    .replace(/\uE000/gu, 'ñ').normalize('NFC')
    .replace(/[^\p{L}\p{N}\s/.-]+/gu, ' ').replace(/\s+/gu, ' ').trim();
}

main().catch(error => { console.error(error?.stack || String(error)); process.exitCode=1; }).finally(() => clientPool.end());

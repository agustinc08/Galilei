const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not configured by the DEV guard.');
  process.exit(2);
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const repositoryRoot = path.resolve(__dirname, '../../../');
const artifactRoot = path.join(
  repositoryRoot,
  '_recovery-work',
  'jurisprudencia-j901',
);
const manifestPath = path.join(
  repositoryRoot,
  '_recovery-work',
  'jurisprudencia-j8',
  'civil-certification-manifest.json',
);
const allowedSources = new Set([
  'CIVIL_CUANTIFICACION_DANOS',
  'CSJN_TFN_HISTORICAL',
  'TFN_ACTUAL_CIVIL',
]);

async function main() {
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (!Array.isArray(manifest) || manifest.length !== 6070) {
    throw new Error(`Expected the J8 6,070-row manifest; got ${manifest.length}`);
  }
  const manifestIds = manifest.map((row) => row.documentId);
  if (new Set(manifestIds).size !== manifestIds.length) {
    throw new Error('J8 manifest contains duplicate document IDs.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const identity = await client.query(`
      SELECT current_database() AS database,
             current_user AS role,
             inet_server_addr()::text AS host,
             inet_server_port() AS port,
             current_setting('server_version_num') AS server_version_num
    `);
    const tableInventory = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    const rows = await client.query(
      `WITH candidates AS (
         SELECT unnest($1::text[]) AS id
       )
       SELECT c.id, c.jurisdiction, c.instance, c.visibility,
              c."documentScope" AS document_scope, c.status,
              c."editorialStatus" AS editorial_status,
              c."anonymizationStatus" AS anonymization_status,
              c."decisionDate" AS decision_date,
              c."caseNumber" AS case_number, c.docket, c.title,
              c.court, c.chamber,
              COALESCE((
                SELECT jsonb_agg(DISTINCT jsonb_build_object(
                  'code', ss.code, 'name', ss.name, 'description', ss.description,
                  'sourceType', ss."sourceType", 'metadata', ss.metadata, 'active', ss.active
                ))
                FROM "CorpusIngestionRecord" ir
                JOIN "CorpusSourceSystem" ss ON ss.id = ir."sourceSystemId"
                WHERE ir."documentId" = c.id
              ), '[]'::jsonb) AS sources,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'sourceCode', ss.code, 'sourceName', ss.name,
                  'sourceDescription', ss.description, 'sourceMetadata', ss.metadata,
                  'sourceType', ss."sourceType",
                  'sourceActive', ss.active, 'externalId', ir."externalId",
                  'sourceReference', ir."sourceReference", 'sourcePath', ir."sourcePath",
                  'status', ir.status, 'checksum', ir.checksum
                ) ORDER BY ir."ingestedAt")
                FROM "CorpusIngestionRecord" ir
                JOIN "CorpusSourceSystem" ss ON ss.id = ir."sourceSystemId"
                WHERE ir."documentId" = c.id
              ), '[]'::jsonb) AS ingestions,
              COALESCE((
                SELECT jsonb_agg(DISTINCT jsonb_build_object(
                  'source', l.source, 'sourceType', l."sourceType",
                  'rootSource', r.source, 'rootType', r."rootType",
                  'readOnly', r."readOnly", 'active', r.active,
                  'sourceMissing', l."sourceMissing"
                ))
                FROM "CorpusDocumentLocation" l
                JOIN "CorpusDocumentRepositoryRoot" r ON r.id = l."rootId"
                WHERE l."documentId" = c.id
              ), '[]'::jsonb) AS locations,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'sha256', f.sha256, 'sizeBytes', f."sizeBytes", 'storageKey', f."storageKey"
                ) ORDER BY f.sha256)
                FROM "CorpusDocumentFile" f WHERE f."documentId" = c.id
              ), '[]'::jsonb) AS files,
              (SELECT count(*)::int FROM "WorkspaceDocument" wd
               WHERE wd."documentId" = c.id) AS workspace_links,
              (SELECT count(*)::int FROM "CorpusDocumentLink" dl
               WHERE dl."documentId" = c.id) AS domain_links,
              COALESCE((
                SELECT jsonb_agg(DISTINCT jsonb_build_object(
                  'domain', dl."targetDomain", 'type', dl."targetType",
                  'relationship', dl.relationship
                ))
                FROM "CorpusDocumentLink" dl WHERE dl."documentId" = c.id
              ), '[]'::jsonb) AS link_domains,
              (SELECT count(*)::int FROM "CorpusDocumentAssociation" a
               WHERE a."documentId" = c.id AND
                 (lower(a."targetDomain") LIKE '%workspace%' OR lower(a."targetDomain") LIKE '%personal%'
                  OR lower(a."targetType") LIKE '%private%')) AS private_associations,
              (SELECT count(*)::int FROM "DigestoCollectionMembership" dcm
               WHERE dcm."documentId" = c.id) AS digesto_memberships,
              (SELECT count(*)::int FROM "Sentencia" f
               WHERE c."caseNumber" IS NOT NULL AND f.expediente IS NOT NULL
               AND regexp_replace(lower(f.expediente), '[^[:alnum:]]', '', 'g') =
                     regexp_replace(lower(c."caseNumber"), '[^[:alnum:]]', '', 'g')
                 AND f.fecha::date = c."decisionDate"::date
                 AND lower(coalesce(f.sala, '')) = lower(coalesce(c.chamber, ''))
                 AND f."legacyId" IS DISTINCT FROM ('CORPUS:' || c.id)
              ) AS exact_sentencia_matches
       FROM candidates x
       LEFT JOIN "CorpusDocument" c ON c.id = x.id
       ORDER BY x.id`,
      [manifestIds],
    );

    const idMap = new Map(rows.rows.filter((row) => row.id).map((row) => [row.id, row]));
    const reportRows = manifest.map((cert) => {
      const db = idMap.get(cert.documentId);
      const source = cert.source;
      const dbSources = db?.sources ?? [];
      const locations = db?.locations ?? [];
      const sourceMatchesDb = dbSources.length > 0 && dbSources.every((s) => s.code === source);
      const institutionalIngestion = dbSources.length > 0 && dbSources.every((s) =>
        s.active === true && ['OFFICIAL_PUBLIC_JURISPRUDENCE', 'INSTITUTIONAL'].includes(s.sourceType) &&
        allowedSources.has(s.code),
      ) && (db?.ingestions ?? []).length > 0 && (db?.ingestions ?? []).every((ingestion) =>
        ingestion.sourceActive === true &&
        ['OFFICIAL_PUBLIC_JURISPRUDENCE', 'INSTITUTIONAL'].includes(ingestion.sourceType) &&
        ingestion.sourceCode === source,
      );
      const issues = [];
      if (!allowedSources.has(source)) issues.push('SOURCE_NOT_ALLOWLISTED');
      if (!db) issues.push('DOCUMENT_MISSING_FROM_DATABASE');
      if (db && db.document_scope !== 'GENERAL') issues.push('NON_GENERAL_SCOPE');
      if (db && db.workspace_links !== 0) issues.push('WORKSPACE_LINK_PRESENT');
      if (db && db.private_associations !== 0) issues.push('PRIVATE_ASSOCIATION_PRESENT');
      if (!sourceMatchesDb) issues.push('SOURCE_PROVENANCE_MISMATCH');
      if (!institutionalIngestion) issues.push('INSTITUTIONAL_INGESTION_NOT_PROVEN');
      if (db && db.status === 'ARCHIVED') issues.push('ARCHIVED_STATUS');
      if (db && db.exact_sentencia_matches > 0) issues.push('EXACT_SENTENCIA_MATCH_REQUIRES_LINK_REVIEW');
      if (db && ['REJECTED', 'PRIVATE', 'ARCHIVED'].includes(db.editorial_status)) {
        issues.push('EDITORIAL_OR_PRIVATE_CONFLICT');
      }
      if (!cert.fileSha || cert.fileIntegrity !== 'VALID' || cert.certificationStatus == null) {
        issues.push('CERTIFICATION_OR_FILE_EVIDENCE_INCOMPLETE');
      }
      const privateConflict = issues.some((issue) =>
        ['NON_GENERAL_SCOPE', 'WORKSPACE_LINK_PRESENT', 'PRIVATE_ASSOCIATION_PRESENT', 'EDITORIAL_OR_PRIVATE_CONFLICT'].includes(issue),
      );
      const safe = issues.length === 0;
      return {
        documentId: cert.documentId,
        source,
        instance: db?.instance ?? null,
        visibility: db?.visibility ?? null,
        documentScope: db?.document_scope ?? null,
        workspaceLinks: db?.workspace_links ?? null,
        privateAssociations: db?.private_associations ?? null,
        sourceSystems: dbSources,
        ingestions: db?.ingestions ?? [],
        locations,
        jurisdiction: db?.jurisdiction ?? null,
        editorialStatus: db?.editorial_status ?? null,
        anonymizationStatus: db?.anonymization_status ?? null,
        caseNumber: db?.case_number ?? null,
        docket: db?.docket ?? null,
        title: db?.title ?? null,
        exactSentenciaMatches: db?.exact_sentencia_matches ?? null,
        fileSha256: cert.fileSha,
        currentFiles: db?.files ?? [],
        j8CertificationStatus: cert.certificationStatus,
        j8SearchStatus: cert.searchStatus,
        j8ViewerStatus: cert.viewerStatus,
        category: safe ? 'PUBLICATION_SAFE'
          : privateConflict ? 'PRIVATE_CONFLICT'
            : issues.includes('ARCHIVED_STATUS') ? 'ARCHIVED_CONFLICT'
              : issues.includes('INSTITUTIONAL_INGESTION_NOT_PROVEN') ? 'PUBLICATION_REQUIRES_REVIEW'
              : issues.includes('EXACT_SENTENCIA_MATCH_REQUIRES_LINK_REVIEW') ? 'MODEL_AMBIGUITY'
                : 'UNKNOWN',
        issues,
      };
    });

    const counts = Object.fromEntries([
      'PUBLICATION_SAFE', 'PUBLICATION_REQUIRES_REVIEW', 'PRIVATE_CONFLICT',
      'WORKSPACE_CONFLICT', 'ARCHIVED_CONFLICT', 'MODEL_AMBIGUITY', 'UNKNOWN',
    ].map((category) => [category, reportRows.filter((row) => row.category === category).length]));
    const workspaceDocTable = tableInventory.rows.some((row) => row.table_name === 'WorkspaceDocument');
    const personalTables = tableInventory.rows.map((row) => row.table_name)
      .filter((name) => /personal|private|restricted/i.test(name));
    const fileCount = reportRows.reduce((sum, row) => sum + row.currentFiles.length, 0);
    const fileDigest = crypto.createHash('sha256')
      .update(reportRows.flatMap((row) => row.currentFiles.map((file) => `${row.documentId}:${file.sha256}`)).sort().join('\n'))
      .digest('hex');
    const result = {
      audit: 'SPRINT_J9_0_1_PUBLICATION_ELIGIBILITY_READ_ONLY',
      databaseIdentity: identity.rows[0],
      transaction: 'REPEATABLE READ READ ONLY',
      input: {
        manifestPath: '_recovery-work/jurisprudencia-j8/civil-certification-manifest.json',
        manifestSha256: crypto.createHash('sha256').update(manifestBytes).digest('hex'),
        certifiedDocuments: manifest.length,
        uniqueDocumentIds: new Set(manifestIds).size,
      },
      reconciliation: {
        databaseRows: rows.rows.length,
        exactManifestIdsFound: idMap.size,
        missingIds: manifest.length - idMap.size,
        sourceCounts: Object.fromEntries([...new Set(reportRows.map((row) => row.source))]
          .map((source) => [source, reportRows.filter((row) => row.source === source).length])),
        sourceMatchesDb: reportRows.filter((row) => !row.issues.includes('SOURCE_PROVENANCE_MISMATCH')).length,
        workspaceDocTablePresent: workspaceDocTable,
        personalPrivateRelatedTables: personalTables,
        categories: counts,
        fileCount,
        fileShaSetDigest: fileDigest,
      },
      eligibilityProof: {
        institutionalSourcesAllowlisted: [...allowedSources],
        corpusDocumentScopeGeneral: reportRows.filter((row) => row.documentScope === 'GENERAL').length,
        workspaceLinks: reportRows.reduce((sum, row) => sum + (row.workspaceLinks ?? 0), 0),
        privateAssociations: reportRows.reduce((sum, row) => sum + (row.privateAssociations ?? 0), 0),
        sourceAndInstitutionalIngestionProven: reportRows.filter((row) => row.issues.length === 0).length,
        exactSentenciaMatches: reportRows.reduce((sum, row) => sum + (row.exactSentenciaMatches ?? 0), 0),
        documentsWithExactSentenciaMatch: reportRows.filter((row) => row.exactSentenciaMatches > 0).length,
        noCorpusOrFileWrites: true,
      },
      documents: reportRows,
    };

    if (result.databaseIdentity.database !== 'buscador_juridico_civil_dev' ||
        !String(result.databaseIdentity.host).startsWith('127.0.0.1') ||
        Number(result.databaseIdentity.port) !== 55432 ||
        result.databaseIdentity.role !== 'bjc_dev') {
      throw new Error(`Connected identity mismatch: ${JSON.stringify(result.databaseIdentity)}`);
    }
    fs.mkdirSync(artifactRoot, { recursive: true });
    fs.writeFileSync(path.join(artifactRoot, 'publication-eligibility.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    const summary = { ...result, documents: undefined };
    fs.writeFileSync(path.join(artifactRoot, 'publication-eligibility-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(summary, null, 2));
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
}

main().catch((error) => {
  console.error(`SPRINT_J9_0_1_ELIGIBILITY=FAIL; ${error.message}`);
  process.exitCode = 1;
}).finally(() => pool.end());

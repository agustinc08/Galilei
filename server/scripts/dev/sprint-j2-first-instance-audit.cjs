'use strict';

// Read-only DEV snapshot for J2. The guard validates URL; this script also validates server identity.
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT = path.join(ROOT, '_recovery-work', 'jurisprudencia-j2');
const EXPECTED = { host: '127.0.0.1', port: 55432, database: 'buscador_juridico_civil_dev', role: 'bjc_dev' };

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('J2_DEV_URL_MISSING');
  const url = new URL(raw);
  if (url.hostname !== EXPECTED.host || Number(url.port) !== EXPECTED.port || url.pathname !== `/${EXPECTED.database}` || url.username !== EXPECTED.role)
    throw new Error('J2_DEV_URL_REJECTED');
  const client = new Client({ connectionString: raw, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const target = (await client.query(`SELECT current_database() database,current_user role,
      inet_server_addr()::text address,inet_server_port() port,current_setting('server_version_num')::int version_num`)).rows[0];
    if (target.database !== EXPECTED.database || target.role !== EXPECTED.role ||
        String(target.address || '').replace(/\/\d+$/u, '') !== EXPECTED.host || Number(target.port) !== EXPECTED.port ||
        target.version_num < 160000 || target.version_num >= 170000) throw new Error('J2_LIVE_DEV_TARGET_REJECTED');
    const counts = (await client.query(`SELECT count(*)::int total,
      count(*) FILTER (WHERE lower(coalesce(court,'')) LIKE '%civil%' OR lower(coalesce(chamber,'')) LIKE '%civil%')::int civil,
      count(*) FILTER (WHERE (lower(coalesce(court,'')) LIKE '%civil%' OR lower(coalesce(chamber,'')) LIKE '%civil%') AND instance='SECOND_INSTANCE')::int second_instance,
      count(*) FILTER (WHERE (lower(coalesce(court,'')) LIKE '%civil%' OR lower(coalesce(chamber,'')) LIKE '%civil%') AND instance='FIRST_INSTANCE')::int first_instance,
      count(*) FILTER (WHERE (lower(coalesce(court,'')) LIKE '%civil%' OR lower(coalesce(chamber,'')) LIKE '%civil%') AND (instance IS NULL OR instance NOT IN ('FIRST_INSTANCE','SECOND_INSTANCE')))::int unknown_instance
      FROM "CorpusDocument"`)).rows[0];
    const first = (await client.query(`SELECT d.id,d.title,d.court,d.chamber,d.instance,d."caseNumber",
      d."decisionDate",d."metadataOriginal",
      i."externalId",i."externalUrl",i."sourceReference",i.status ingestionStatus,f.sha256,f."mimeType",f."sizeBytes",f."pageCount",
      s.code sourceCode
      FROM "CorpusDocument" d
      LEFT JOIN LATERAL (SELECT * FROM "CorpusIngestionRecord" WHERE "documentId"=d.id ORDER BY "createdAt" LIMIT 1) i ON true
      LEFT JOIN "CorpusDocumentFile" f ON f.id=i."fileId"
      LEFT JOIN "CorpusSourceSystem" s ON s.id=i."sourceSystemId"
      WHERE (lower(coalesce(d.court,'')) LIKE '%civil%' OR lower(coalesce(d.chamber,'')) LIKE '%civil%') AND d.instance='FIRST_INSTANCE' ORDER BY d.id`)).rows;
    const candidates = (await client.query(`SELECT d.id,d.title,d.court,d.chamber,d.instance,d."caseNumber",d."decisionDate",
      d."metadataOriginal"::text original_text
      FROM "CorpusDocument" d WHERE (lower(coalesce(d.court,'')) LIKE '%civil%' OR lower(coalesce(d.chamber,'')) LIKE '%civil%') AND d.instance='SECOND_INSTANCE'
      AND d."metadataOriginal"::text ~* '(JUZGADO.{0,40}(PRIMERA|1RA).{0,40}INSTANCIA.{0,80}CIVIL|JUZGADO NACIONAL.{0,80}EN LO CIVIL)'
      ORDER BY d.id`)).rows;
    const targets = (await client.query(`SELECT d.id,d.title,d."caseNumber",d.court,d.chamber,d."decisionDate",
      f.id "fileId",f.sha256,f."originalFilename",f."mimeType",f."sizeBytes",f."pageCount",f."storageKey",
      e.status extractionStatus,length(e.text)::int extractedChars,e.text extractionText
      FROM "CorpusDocument" d JOIN "CorpusDocumentFile" f ON f."documentId"=d.id
      LEFT JOIN LATERAL (SELECT status,text FROM "CorpusExtraction" WHERE "fileId"=f.id ORDER BY "extractedAt" DESC LIMIT 1) e ON true
      WHERE d.id=ANY($1::text[]) ORDER BY d.id,f.version`, [['cmv0q2p2h0051rc8vae3uy74g','cmv0q7834003hws8v3wru3ha7']])).rows;
    const result = { status: 'J2_READ_ONLY_AUDIT_PASS', target: { ...target, address: String(target.address || '').replace(/\/\d+$/u, '') },
      counts, firstInstanceDocuments: first, secondInstanceWithExplicitFirstInstanceEvidence: candidates.map(({original_text,...r})=>({...r,metadataEvidence:r.metadataOriginal})),
      secondInstanceEvidenceCount: candidates.length, targetLegalIdentityCandidates: targets };
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'first-instance-current.json'), `${JSON.stringify(result, null, 2)}\n`);
    await client.query('ROLLBACK');
    console.log(JSON.stringify({ status: result.status, target: result.target, counts, firstInstanceDocuments: first.length,
      secondInstanceFirstInstanceEvidenceCount: candidates.length, targetLegalIdentityCandidates: targets.map(({extractionText,...x})=>({...x, extractionText: undefined})) }, null, 2));
  } finally { await client.end(); }
}

main().catch(error => { console.error(`J2_AUDIT_FAILED: ${error.message}`); process.exitCode = 1; });

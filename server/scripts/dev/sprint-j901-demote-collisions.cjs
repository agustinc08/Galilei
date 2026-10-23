const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL_MISSING_FROM_DEV_GUARD');
const target = new URL(databaseUrl);
if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') throw new Error('DEV_DATABASE_TARGET_REJECTED');
if (!process.argv.includes('--apply') || process.argv.filter(x => x === '--apply').length !== 1) throw new Error('EXPLICIT_--apply_REQUIRED');

const root = path.resolve(__dirname, '../../../');
const artifactRoot = path.join(root, '_recovery-work', 'jurisprudencia-j901');
const report = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'legacy-publication-dry-run.json'), 'utf8'));
if (report.databaseIdentity?.database !== 'buscador_juridico_civil_dev' || report.databaseIdentity?.role !== 'bjc_dev' || !String(report.databaseIdentity?.host).startsWith('127.0.0.1') || Number(report.databaseIdentity?.port) !== 55432) throw new Error('DRY_RUN_DATABASE_IDENTITY_MISMATCH');
const conflicts = report.candidates.filter(row => row.existingLegacy && row.issues.includes('LEGAL_KEY_COLLISION'));
if (conflicts.length !== 36 || conflicts.some(row => row.category !== 'MODEL_AMBIGUITY')) throw new Error(`COLLISION_SET_UNEXPECTED:${conflicts.length}`);

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const identity = (await client.query('SELECT current_database() AS database,current_user AS role,inet_server_addr()::text AS host,inet_server_port() AS port')).rows[0];
    if (identity.database !== 'buscador_juridico_civil_dev' || identity.role !== 'bjc_dev' || !String(identity.host).startsWith('127.0.0.1') || Number(identity.port) !== 55432) throw new Error('DB_IDENTITY_MISMATCH');
    const ids = conflicts.map(row => row.documentId);
    const found = await client.query(`
      SELECT s.id,s."legacyId",s.publicado,s."slugPublico",s."publishedAt",l.id AS link_id,l.metadata
      FROM "Sentencia" s JOIN "CorpusDocumentLink" l ON l."targetId"=s.id::text
      WHERE s."legacyId"=ANY($1::text[]) AND l."targetDomain"='JURISPRUDENCIA' AND l."targetType"='SENTENCIA' AND l.relationship='ASSOCIATED_WITH'
      ORDER BY s."legacyId"`, [ids.map(id => `CORPUS:${id}`)]);
    if (found.rows.length !== conflicts.length || found.rows.some(row => !row.publicado || !row.metadata || row.metadata.operation !== 'LEGACY_JURISPRUDENCE_PUBLICATION_BACKFILL')) throw new Error(`COLLISION_WORKFLOW_RECONCILIATION_FAILED:${found.rows.length}`);
    const outcome = await client.query(`
      UPDATE "Sentencia" SET publicado=false,activo=true,"estadoCarga"='BORRADOR',"publishedAt"=NULL,"slugPublico"=NULL,"updatedAt"=now()
      WHERE "legacyId"=ANY($1::text[]) AND publicado=true`, [ids.map(id => `CORPUS:${id}`)]);
    await client.query(`
      UPDATE "CorpusDocumentLink" SET metadata=metadata || jsonb_build_object('publicationStatus','REQUIRES_REVIEW_LEGAL_KEY_COLLISION','publicationDemotedAt',now())
      WHERE "targetDomain"='JURISPRUDENCIA' AND "targetType"='SENTENCIA' AND relationship='ASSOCIATED_WITH'
        AND metadata->>'operation'='LEGACY_JURISPRUDENCE_PUBLICATION_BACKFILL' AND "documentId"=ANY($1::text[])`, [ids]);
    if (outcome.rowCount !== conflicts.length) throw new Error(`DEMOTED_COUNT_MISMATCH:${outcome.rowCount}`);
    await client.query('COMMIT');
    const result = { action:'SPRINT_J9_0_1_COLLISION_REMEDIATION', databaseIdentity:identity, demoted:outcome.rowCount, conflictDocumentIds:ids, sentenceFilesAndCorpusPreserved:true, searchProjectionRebuilds:0, reason:'Intra-corpus legal-key collisions require human identity review before public publication.' };
    fs.writeFileSync(path.join(artifactRoot,'collision-remediation.json'),`${JSON.stringify(result,null,2)}\n`,'utf8');
    console.log(JSON.stringify({result:result.action,demoted:result.demoted,corpusChanged:false,filesChanged:false},null,2));
  } catch (error) { try { await client.query('ROLLBACK'); } catch {} throw error; }
  finally { client.release(); }
}
main().catch(error => { console.error(error?.stack||String(error));process.exitCode=1; }).finally(()=>pool.end());

const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');

const raw = process.env.DATABASE_URL;
if (!raw) throw new Error('DATABASE_URL_MISSING_FROM_DEV_GUARD');
const target = new URL(raw);
if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') throw new Error('DEV_DATABASE_TARGET_REJECTED');

const pool = new Pool({ connectionString: raw, max: 1 });
async function main() {
  const identity = (await pool.query('SELECT current_database() AS database,current_user AS role,inet_server_addr()::text AS host,inet_server_port() AS port')).rows[0];
  if (identity.database !== 'buscador_juridico_civil_dev' || identity.role !== 'bjc_dev' || !String(identity.host).startsWith('127.0.0.1') || Number(identity.port) !== 55432) throw new Error('DB_IDENTITY_MISMATCH');
  const rows = await pool.query(`
    SELECT s.id,s.publicado,s.activo,s.caratula,s.expediente,
           d.id AS document_id,d."searchText",d.title,d."documentScope" AS "documentScope",d.jurisdiction,d.visibility,
           f.sha256,f."storageKey" AS "storageKey",f."originalFilename" AS "originalFilename",
           (SELECT a."nombreArchivo" FROM "ArchivoPdf" a WHERE a."sentenciaId"=s.id ORDER BY a.id LIMIT 1) AS "legacyFilename",
           (SELECT count(*)::int FROM "AccionLog" a WHERE a.entidad='SENTENCIA' AND a."entidadId"=s.id) AS "auditRows"
    FROM "Sentencia" s
    LEFT JOIN "CorpusDocumentLink" l ON l."targetDomain"='JURISPRUDENCIA' AND l."targetType"='SENTENCIA' AND l."targetId"=s.id::text
    LEFT JOIN "CorpusDocument" d ON d.id=l."documentId"
    LEFT JOIN "CorpusDocumentFile" f ON f."documentId"=d.id
    WHERE EXISTS (SELECT 1 FROM "ArchivoPdf" ax WHERE ax."sentenciaId"=s.id AND ax."nombreArchivo"='fallo-j901-sintetico.pdf') OR f."originalFilename"='fallo-j901-sintetico.pdf' OR s.caratula LIKE '%J9VALIDACIONUNICA%' OR s.expediente LIKE '%J9VALIDACIONUNICA%' OR d."searchText" LIKE '%J9VALIDACIONUNICA%'
    ORDER BY s.id`);
  const projection = await pool.query(`
    SELECT count(DISTINCT t."documentId")::int AS projected_documents,
           count(*)::int AS tokens,
           count(*) FILTER (WHERE d.id IS NULL)::int AS orphan_tokens
    FROM "CorpusSearchToken" t LEFT JOIN "CorpusDocument" d ON d.id=t."documentId"`);
  const recentDocuments = await pool.query(`
    SELECT d.id,d.title,d."documentScope",d.jurisdiction,d.status,d.visibility,d."createdAt",
           (SELECT count(*)::int FROM "WorkspaceDocument" w WHERE w."documentId"=d.id) AS workspace_links,
           (SELECT count(*)::int FROM "CorpusDocumentLink" l WHERE l."documentId"=d.id) AS domain_links,
           (SELECT count(*)::int FROM "CorpusSearchToken" t WHERE t."documentId"=d.id) AS search_tokens
    FROM "CorpusDocument" d ORDER BY d."createdAt" DESC LIMIT 15`);
  const report = { action:'SPRINT_J9_0_1_SYNTHETIC_RESIDUE_READ_ONLY', identity:{database:identity.database,role:identity.role,host:identity.host,port:Number(identity.port)}, rows:rows.rows, projection:projection.rows[0], recentDocuments:recentDocuments.rows, complete:true };
  const artifactDir = path.resolve(__dirname, '../../../_recovery-work/jurisprudencia-j901');
  fs.mkdirSync(artifactDir,{recursive:true});
  fs.writeFileSync(path.join(artifactDir,'synthetic-residue-readonly.json'),`${JSON.stringify(report,null,2)}\n`,'utf8');
  console.log(JSON.stringify({action:report.action,matchCount:rows.rowCount,projection:report.projection,rows:rows.rows.map(row=>({id:row.id,published:row.publicado,active:row.activo,documentId:row.document_id,sha256:row.sha256,storageKey:row.storageKey,auditRows:row.auditRows})),recentDocuments:report.recentDocuments},null,2));
}
main().catch(error=>{console.error(error?.stack||String(error));process.exitCode=1;}).finally(()=>pool.end());

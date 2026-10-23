const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const raw = process.env.DATABASE_URL;
if (!raw) throw new Error('DATABASE_URL_MISSING_FROM_DEV_GUARD');
const target = new URL(raw);
if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') throw new Error('DEV_DATABASE_TARGET_REJECTED');
if (process.argv.filter(value => value === '--apply').length !== 1) throw new Error('EXPLICIT_--apply_REQUIRED');

const root = path.resolve(__dirname, '../../../');
const artifactRoot = path.join(root, '_recovery-work', 'jurisprudencia-j901');
const manifestPath = path.join(artifactRoot, 'synthetic-residue-readonly.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.action !== 'SPRINT_J9_0_1_SYNTHETIC_RESIDUE_READ_ONLY' || manifest.identity?.database !== 'buscador_juridico_civil_dev' || manifest.identity?.role !== 'bjc_dev' || manifest.identity?.port !== 55432 || !String(manifest.identity?.host).startsWith('127.0.0.1')) throw new Error('SYNTHETIC_MANIFEST_IDENTITY_INVALID');
const rows = manifest.rows;
if (!Array.isArray(rows) || !rows.length) throw new Error('SYNTHETIC_MANIFEST_EMPTY');

const pool = new Pool({ connectionString: raw, max: 1 });
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function extractMarker(row) {
  const matches = [...`${row.caratula ?? ''} ${row.searchText ?? ''}`.matchAll(/J9VALIDACIONUNICA\d+/gu)].map(match => match[0]);
  const unique = [...new Set(matches)];
  if (unique.length > 1) throw new Error(`SYNTHETIC_MARKER_AMBIGUOUS:${row.id}`);
  if (unique.length === 1) return unique[0];
  if (row.originalFilename === 'fallo-j901-sintetico.pdf' && row.title === 'Borrador de fallo' && row.documentScope === 'GENERAL' && row.jurisdiction === 'CIVIL' && row.visibility === 'INTERNAL' && /j9validac/iu.test(row.searchText ?? '') && /carga manual de jurisprudencia/iu.test(row.searchText ?? '')) return null;
  throw new Error(`SYNTHETIC_MARKER_MISSING:${row.id}`);
}

async function main() {
  const identity = (await pool.query('SELECT current_database() AS database,current_user AS role,inet_server_addr()::text AS host,inet_server_port() AS port')).rows[0];
  if (identity.database !== 'buscador_juridico_civil_dev' || identity.role !== 'bjc_dev' || !String(identity.host).startsWith('127.0.0.1') || Number(identity.port) !== 55432) throw new Error('DB_IDENTITY_MISMATCH');
  const removed = [];
  const physicalCandidates = new Map();
  for (const row of rows) {
    const sentenceId = Number(row.id);
    const marker = extractMarker(row);
    if (!Number.isInteger(sentenceId) || sentenceId <= 0 || !/^[a-f0-9]{64}$/iu.test(row.sha256 ?? '') || !row.document_id || !row.storageKey) throw new Error(`SYNTHETIC_MANIFEST_ROW_INVALID:${row.id}`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const sentence = await client.query('SELECT id,publicado,activo,caratula,expediente FROM "Sentencia" WHERE id=$1 FOR UPDATE', [sentenceId]);
      if (sentence.rowCount !== 1 || (marker && !`${sentence.rows[0].caratula ?? ''} ${sentence.rows[0].expediente ?? ''}`.includes(marker))) throw new Error(`SYNTHETIC_SENTENCE_IDENTITY_MISMATCH:${sentenceId}`);
      const docs = await client.query(`
        SELECT DISTINCT d.id,d."searchText",d.title,d."documentScope" AS document_scope,d.jurisdiction,d.visibility,
          f.id AS file_id,f."storageKey" AS storage_key,f.sha256,f."storageProvider" AS storage_provider,f."originalFilename" AS original_filename
        FROM "CorpusDocumentLink" l JOIN "CorpusDocument" d ON d.id=l."documentId"
        LEFT JOIN "CorpusDocumentFile" f ON f."documentId"=d.id
        WHERE l."targetDomain"='JURISPRUDENCIA' AND l."targetType"='SENTENCIA' AND l."targetId"=$1`, [String(sentenceId)]);
      if (docs.rowCount !== 1 || docs.rows[0].id !== row.document_id || docs.rows[0].sha256 !== row.sha256 || docs.rows[0].storage_key !== row.storageKey || docs.rows[0].original_filename !== row.originalFilename || !/^fallo-j901-sintetico(?:-duplicado)?\.pdf$/iu.test(docs.rows[0].original_filename ?? '')) throw new Error(`SYNTHETIC_CORPUS_IDENTITY_MISMATCH:${sentenceId}:${JSON.stringify(docs.rows.map(doc=>({id:doc.id,sha256:doc.sha256,storageKey:doc.storage_key,originalFilename:doc.original_filename})))}`);
      if (!marker && (docs.rows[0].title !== 'Borrador de fallo' || docs.rows[0].document_scope !== 'GENERAL' || docs.rows[0].jurisdiction !== 'CIVIL' || docs.rows[0].visibility !== 'INTERNAL' || !/j9validac/iu.test(docs.rows[0].searchText ?? '') || !/carga manual de jurisprudencia/iu.test(docs.rows[0].searchText ?? ''))) throw new Error(`UNMARKED_SYNTHETIC_METADATA_MISMATCH:${sentenceId}`);
      const linkCount = await client.query('SELECT count(*)::int AS count FROM "CorpusDocumentLink" WHERE "documentId"=$1', [row.document_id]);
      const workspaceCount = await client.query('SELECT count(*)::int AS count FROM "WorkspaceDocument" WHERE "documentId"=$1', [row.document_id]);
      if (Number(linkCount.rows[0].count) !== 1 || Number(workspaceCount.rows[0].count) !== 0) throw new Error(`SYNTHETIC_DOCUMENT_SHARED_OR_PRIVATE:${sentenceId}`);
      const archivos = await client.query('SELECT id,"nombreArchivo" FROM "ArchivoPdf" WHERE "sentenciaId"=$1', [sentenceId]);
      if (archivos.rows.some(file => file.nombreArchivo !== `${row.sha256}.pdf`) || (row.legacyFilename === null && archivos.rowCount !== 0) || (row.legacyFilename && (archivos.rowCount !== 1 || archivos.rows[0].nombreArchivo !== row.legacyFilename))) throw new Error(`SYNTHETIC_LEGACY_FILE_IDENTITY_MISMATCH:${sentenceId}:${JSON.stringify(archivos.rows)}`);
      const storageRoots = [
        path.resolve(root, '_dev-corpus-storage'),
        path.resolve(root, '_dev-corpus-storage-test', 'sprint1561-e2e'),
      ];
      const matchingBlobs = storageRoots
        .map((storageRoot) => ({
          storageRoot,
          absolutePath: path.resolve(storageRoot, row.storageKey),
        }))
        .filter(({ storageRoot, absolutePath }) =>
          absolutePath.startsWith(`${storageRoot}${path.sep}`) &&
          fs.existsSync(absolutePath) &&
          sha256(absolutePath) === row.sha256,
        );
      if (matchingBlobs.length !== 1) throw new Error(`SYNTHETIC_BLOB_HASH_OR_PATH_MISMATCH:${sentenceId}`);
      const { absolutePath: abs } = matchingBlobs[0];
      physicalCandidates.set(row.storageKey, { absolutePath: abs, sha256: row.sha256 });
      await client.query('DELETE FROM "CorpusDocumentLink" WHERE "targetDomain"=\'JURISPRUDENCIA\' AND "targetType"=\'SENTENCIA\' AND "targetId"=$1', [String(sentenceId)]);
      const deletedSentence = await client.query('DELETE FROM "Sentencia" WHERE id=$1 AND "legacyId" IS NULL', [sentenceId]);
      if (deletedSentence.rowCount !== 1) throw new Error(`SYNTHETIC_SENTENCE_DELETE_MISMATCH:${sentenceId}`);
      const auditDelete = await client.query('DELETE FROM "AccionLog" WHERE entidad=\'SENTENCIA\' AND "entidadId"=$1', [sentenceId]);
      const tokenDelete = await client.query('DELETE FROM "CorpusSearchToken" WHERE "documentId"=$1', [row.document_id]);
      const stateDelete = await client.query('DELETE FROM "CorpusSearchTokenState" WHERE "documentId"=$1', [row.document_id]);
      await client.query('DELETE FROM "CorpusDocument" WHERE id=$1', [row.document_id]);
      await client.query('COMMIT');
      removed.push({ sentenceId, marker, documentId: row.document_id, sha256: row.sha256, removedAuditRows: auditDelete.rowCount, removedSearchTokens: tokenDelete.rowCount, removedSearchStates: stateDelete.rowCount });
    } catch (error) { try { await client.query('ROLLBACK'); } catch {} throw error; }
    finally { client.release(); }
  }

  const removedBlobs = [];
  for (const [storageKey, item] of physicalCandidates) {
    const references = await pool.query('SELECT count(*)::int AS count FROM "CorpusDocumentFile" WHERE "storageKey"=$1', [storageKey]);
    if (Number(references.rows[0].count) !== 0) throw new Error(`SYNTHETIC_BLOB_SHARED_AFTER_CLEANUP:${storageKey}`);
    if (!fs.existsSync(item.absolutePath) || sha256(item.absolutePath) !== item.sha256) throw new Error(`SYNTHETIC_BLOB_CHANGED_AFTER_DELETE:${storageKey}`);
    fs.unlinkSync(item.absolutePath);
    removedBlobs.push(storageKey);
  }
  const residual = await pool.query(`
    SELECT (SELECT count(*)::int FROM "Sentencia" WHERE id=ANY($1::int[])) AS sentences,
           (SELECT count(*)::int FROM "CorpusDocument" WHERE id=ANY($2::text[])) AS corpus_docs,
           (SELECT count(*)::int FROM "CorpusDocumentLink" WHERE "targetDomain"='JURISPRUDENCIA' AND "targetId"=ANY($3::text[])) AS links,
           (SELECT count(*)::int FROM "AccionLog" WHERE entidad='SENTENCIA' AND "entidadId"=ANY($4::int[])) AS audit,
           (SELECT count(*)::int FROM "ArchivoPdf" WHERE "sentenciaId"=ANY($1::int[])) AS legacy_files,
           (SELECT count(*)::int FROM "CorpusDocumentFile" WHERE "storageKey"=ANY($5::text[])) AS corpus_files,
           (SELECT count(*)::int FROM "CorpusSearchToken" WHERE "documentId"=ANY($2::text[])) AS search_tokens,
           (SELECT count(*)::int FROM "CorpusSearchTokenState" WHERE "documentId"=ANY($2::text[])) AS search_states`,
    [removed.map(item=>item.sentenceId),removed.map(item=>item.documentId),removed.map(item=>String(item.sentenceId)),removed.map(item=>item.sentenceId),removedBlobs]);
  const residuals = Object.fromEntries(Object.entries(residual.rows[0]).map(([key,value])=>[key,Number(value)]));
  if (Object.values(residuals).some(Boolean)) throw new Error(`SYNTHETIC_RESIDUAL_DETECTED:${JSON.stringify(residuals)}`);
  const report = { action:'SPRINT_J9_0_1_SYNTHETIC_CLEANUP', db:{database:identity.database,role:identity.role,host:identity.host,port:Number(identity.port)}, removedSyntheticSentencias:removed.length, removedSyntheticCorpusDocuments:removed.length, removedSyntheticCorpusFiles:removed.length, removedPhysicalBlobs:removedBlobs, removedSyntheticAuditRows:removed.reduce((sum,item)=>sum+item.removedAuditRows,0), removedSyntheticUsers:0, removedSyntheticSearchRows:removed.reduce((sum,item)=>sum+item.removedSearchTokens,0), removedSyntheticSearchStates:removed.reduce((sum,item)=>sum+item.removedSearchStates,0), removed, residuals, complete:true };
  fs.writeFileSync(path.join(artifactRoot,'cleanup.json'),`${JSON.stringify(report,null,2)}\n`,'utf8');
  console.log(JSON.stringify({action:report.action,removedSyntheticSentencias:report.removedSyntheticSentencias,removedPhysicalBlobs:removedBlobs.length,removedSyntheticAuditRows:report.removedSyntheticAuditRows,residuals},null,2));
}
main().catch(error=>{console.error(error?.stack||String(error));process.exitCode=1;}).finally(()=>pool.end());

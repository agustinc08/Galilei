'use strict';

const { Client } = require('pg');

const EXPECTED_CURRENT = '2026-10-14T05:32:36.949Z';
const PREVIOUS_J4 = '2026-10-14T04:33:07.529Z';

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '55432' ||
      url.pathname !== '/buscador_juridico_civil_dev' || url.username !== 'bjc_dev') throw new Error('J5_RESTORE_TARGET_REJECTED');
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, statement_timeout: 10000 });
  await client.connect();
  try {
    await client.query('BEGIN');
    const identity=(await client.query(`SELECT current_database() database,current_user role,inet_server_addr()::text address,inet_server_port() port`)).rows[0];
    if (identity.database!=='buscador_juridico_civil_dev'||identity.role!=='bjc_dev'||String(identity.address||'').replace(/\/\d+$/u,'')!=='127.0.0.1'||Number(identity.port)!==55432) throw new Error('J5_RESTORE_LIVE_IDENTITY_REJECTED');
    const marker=(await client.query(`SELECT "isReady","verifiedAt" FROM "CorpusSearchTokenProjectionControl" WHERE "singleton"=true FOR UPDATE`)).rows[0];
    if (marker?.isReady!==true || new Date(marker.verifiedAt).toISOString()!==EXPECTED_CURRENT) throw new Error('J5_RESTORE_CURRENT_MARKER_MISMATCH');
    const before=(await client.query(`SELECT (SELECT count(*)::int FROM "CorpusDocument") documents,
      (SELECT count(*)::int FROM "CorpusDocumentFile") files,(SELECT count(*)::int FROM "CorpusIngestionRecord") ingestions,
      (SELECT count(*)::int FROM "CorpusSearchToken") tokens`)).rows[0];
    await client.query(`UPDATE "CorpusSearchTokenProjectionControl" SET "verifiedAt"=$1::timestamptz WHERE "singleton"=true`,[PREVIOUS_J4]);
    const after=(await client.query(`SELECT (SELECT count(*)::int FROM "CorpusDocument") documents,
      (SELECT count(*)::int FROM "CorpusDocumentFile") files,(SELECT count(*)::int FROM "CorpusIngestionRecord") ingestions,
      (SELECT count(*)::int FROM "CorpusSearchToken") tokens`)).rows[0];
    const restored=(await client.query(`SELECT "isReady","verifiedAt" FROM "CorpusSearchTokenProjectionControl" WHERE "singleton"=true`)).rows[0];
    if (JSON.stringify(before)!==JSON.stringify(after)||restored.isReady!==true||new Date(restored.verifiedAt).toISOString()!==PREVIOUS_J4) throw new Error('J5_RESTORE_POSTCHECK_FAILED');
    await client.query('COMMIT');
    process.stdout.write(JSON.stringify({status:'J5_PROJECTION_MARKER_RESTORED',marker:{isReady:restored.isReady,verifiedAt:new Date(restored.verifiedAt).toISOString()},before,after,onlyFieldUpdated:'CorpusSearchTokenProjectionControl.verifiedAt'},null,2)+'\n');
  } catch(error) { try { await client.query('ROLLBACK'); } catch {} throw error; }
  finally { await client.end(); }
}

main().catch(error=>{console.error(`J5_RESTORE_ABORT=${error.stack||error.message}`);process.exitCode=1;});

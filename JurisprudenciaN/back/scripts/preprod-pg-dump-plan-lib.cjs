const path = require('node:path');

const CLEAR_LIBPQ_VARIABLES = [
  'PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGSERVICE',
  'PGSERVICEFILE', 'PGPASSWORD', 'PGPASSFILE', 'PGOPTIONS', 'PGTARGETSESSIONATTRS',
  'PGCHANNELBINDING', 'PGSSLMODE', 'PGSSLROOTCERT', 'PGSSLCERT', 'PGSSLKEY',
  'PGSSLCRL', 'PGSSLCRLDIR', 'PGSSLNEGOTIATION', 'PGGSSENCMODE',
  'PGLOADBALANCEHOSTS', 'PGREQUIRESSL',
];

function buildPgDumpPlan(database, passFile, outputFile) {
  if (
    !database ||
    database.database !== 'buscador_juridico_civil_preprod' ||
    database.user === 'bjc_dev' ||
    !database.host ||
    !Number.isInteger(database.port) ||
    database.tlsMode !== 'verify-full' ||
    !path.isAbsolute(database.caPath) ||
    !path.isAbsolute(passFile || '') ||
    !path.isAbsolute(outputFile || '')
  ) throw new Error('PG_DUMP_CANONICAL_TARGET_INVALID');

  const args = [
    '--no-password',
    '--host', database.host,
    '--port', String(database.port),
    '--username', database.user,
    '--format=custom',
    '--no-owner',
    '--file', outputFile,
    database.database,
  ];
  const serializedArgs = JSON.stringify(args);
  if ((database.password && serializedArgs.includes(database.password)) || serializedArgs.includes('postgresql://')) {
    throw new Error('PG_DUMP_SECRET_ARGUMENT_REJECTED');
  }

  return {
    target: {
      host: database.host,
      port: database.port,
      database: database.database,
      user: database.user,
      tlsMode: 'verify-full',
    },
    args,
    clearLibpqVariables: CLEAR_LIBPQ_VARIABLES,
    environment: {
      PGPASSFILE: passFile,
      PGSSLMODE: 'verify-full',
      PGSSLROOTCERT: database.caPath,
    },
  };
}

module.exports = { buildPgDumpPlan };

import type { ApprovedRuntimePgConfig } from '../config/runtime-database-config';
import { PostgresJurisprudenciaSearchAdapter } from './adapters/postgres-jurisprudencia-search.adapter';
import { CorpusSearchSourceAdapter } from '../corpus/corpus-search.adapter';

/** Create both PostgreSQL hydrators from the exact same approved runtime identity. */
export function createSearchPostgresHydrators(
  database: ApprovedRuntimePgConfig,
) {
  return {
    jurisprudencia: new PostgresJurisprudenciaSearchAdapter(database),
    corpus: new CorpusSearchSourceAdapter(database),
  };
}

import { Module, type Provider } from '@nestjs/common';
import type { ApprovedRuntimePgConfig } from '../config/runtime-database-config';
import { getRuntimeDatabasePoolConfig } from '../config/runtime-database-config';
import { EstadisticasModule } from '../estadisticas/estadisticas.module';
import { IaModule } from '../ia/ia.module';
import { InstitutosJuridicosModule } from '../institutos-juridicos/institutos-juridicos.module';
import {
  BusquedaController,
  PublicBusquedaController,
} from './busqueda.controller';
import { BusquedaService } from './busqueda.service';
import { FederatedSearchService } from './federated-search.service';
import { OpenSearchRuntimeService } from './opensearch/opensearch-runtime.service';
import { createSearchPostgresHydrators } from './search-postgres-adapters';

export const SEARCH_DATABASE_POOL_CONFIG = Symbol(
  'SEARCH_DATABASE_POOL_CONFIG',
);

type MaybeApprovedDatabase = ApprovedRuntimePgConfig | null;

/** The preflight-approved identity object shared by every Search-side PG pool. */
export function createSearchDatabasePoolConfig(
  env: NodeJS.ProcessEnv = process.env,
): MaybeApprovedDatabase {
  if (env.NODE_ENV === 'test' || env.SEARCH_ENGINE !== 'opensearch')
    return null;
  return getRuntimeDatabasePoolConfig(env);
}

export const BUSQUEDA_RUNTIME_PROVIDERS: Provider[] = [
  {
    provide: SEARCH_DATABASE_POOL_CONFIG,
    useFactory: createSearchDatabasePoolConfig,
  },
  {
    provide: OpenSearchRuntimeService,
    inject: [SEARCH_DATABASE_POOL_CONFIG],
    useFactory: (database: MaybeApprovedDatabase) => {
      if (process.env.NODE_ENV === 'test') return null;
      if (process.env.SEARCH_ENGINE !== 'opensearch')
        throw new Error('SEARCH_ENGINE_MUST_BE_OPENSEARCH');
      if (!database) throw new Error('SEARCH_DATABASE_CONFIG_REQUIRED');
      return new OpenSearchRuntimeService(database);
    },
  },
  {
    provide: FederatedSearchService,
    inject: [OpenSearchRuntimeService, SEARCH_DATABASE_POOL_CONFIG],
    useFactory: (
      runtime: OpenSearchRuntimeService | null,
      database: MaybeApprovedDatabase,
    ) => {
      if (!runtime) return new FederatedSearchService(null, null);
      if (!database) throw new Error('SEARCH_DATABASE_CONFIG_REQUIRED');
      const { jurisprudencia: jurisprudenciaHydrator, corpus: corpusHydrator } =
        createSearchPostgresHydrators(database);
      const jurisprudencia = runtime.createSource(
        'JURISPRUDENCIA',
        async (query, context, ids) => {
          const sentenciaKeys = ids.filter((id) => id.startsWith('SENTENCIA:'));
          const sumarioIds = ids.filter((id) => !id.startsWith('SENTENCIA:'));
          const unknownKeys = sumarioIds.filter((id) => !/^\d+$/u.test(id));
          if (unknownKeys.length)
            throw new Error('SEARCH_CANDIDATE_ID_INVALID');
          const [sentencias, sumarios] = await Promise.all([
            sentenciaKeys.length
              ? jurisprudenciaHydrator.hydrateSentenciaCandidates(
                  sentenciaKeys,
                  query,
                  context,
                )
              : Promise.resolve(null),
            sumarioIds.length
              ? jurisprudenciaHydrator.search(query, context, sumarioIds)
              : Promise.resolve(null),
          ]);
          const results = [
            ...(sentencias?.results ?? []),
            ...(sumarios?.results ?? []),
          ];
          return {
            total: results.length,
            totalExact: true,
            hasMore: false,
            page: context.page ?? 1,
            pageSize: context.pageSize ?? results.length,
            results,
          };
        },
        () => jurisprudenciaHydrator.close(),
      );
      const corpus = runtime.createSource(
        'CORPUS',
        (query, context, ids) => corpusHydrator.search(query, context, ids),
        () => corpusHydrator.close(),
      );
      return new FederatedSearchService(jurisprudencia, corpus, 5000, true);
    },
  },
];

@Module({
  imports: [EstadisticasModule, IaModule, InstitutosJuridicosModule],
  controllers: [BusquedaController, PublicBusquedaController],
  providers: [BusquedaService, ...BUSQUEDA_RUNTIME_PROVIDERS],
  exports: [BusquedaService, OpenSearchRuntimeService],
})
export class BusquedaModule {}

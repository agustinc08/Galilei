import { Module } from '@nestjs/common';
import { EstadisticasModule } from '../estadisticas/estadisticas.module';
import { IaModule } from '../ia/ia.module';
import { InstitutosJuridicosModule } from '../institutos-juridicos/institutos-juridicos.module';
import {
  BusquedaController,
  PublicBusquedaController,
} from './busqueda.controller';
import { BusquedaService } from './busqueda.service';
import { FederatedSearchService } from './federated-search.service';
import { PostgresJurisprudenciaSearchAdapter } from './adapters/postgres-jurisprudencia-search.adapter';
import { CorpusSearchSourceAdapter } from '../corpus/corpus-search.adapter';
import { OpenSearchRuntimeService } from './opensearch/opensearch-runtime.service';

@Module({
  imports: [EstadisticasModule, IaModule, InstitutosJuridicosModule],
  controllers: [BusquedaController, PublicBusquedaController],
  providers: [
    BusquedaService,
    {
      provide: OpenSearchRuntimeService,
      useFactory: () => {
        if (process.env.NODE_ENV === 'test') return null;
        if (process.env.SEARCH_ENGINE !== 'opensearch')
          throw new Error('SEARCH_ENGINE_MUST_BE_OPENSEARCH');
        return new OpenSearchRuntimeService();
      },
    },
    {
      provide: FederatedSearchService,
      inject: [OpenSearchRuntimeService],
      useFactory: (runtime: OpenSearchRuntimeService | null) => {
        if (!runtime) return new FederatedSearchService(null, null);
        const raw = process.env.DATABASE_URL;
        if (!raw) throw new Error('SEARCH_DATABASE_URL_REQUIRED');
        const jurisprudenciaHydrator = new PostgresJurisprudenciaSearchAdapter(
          raw,
        );
        const corpusHydrator = new CorpusSearchSourceAdapter(raw);
        const jurisprudencia = runtime.createSource(
          'JURISPRUDENCIA',
          async (query, context, ids) => {
            const sentenciaKeys = ids.filter((id) =>
              id.startsWith('SENTENCIA:'),
            );
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
  ],
  exports: [BusquedaService, OpenSearchRuntimeService],
})
export class BusquedaModule {}

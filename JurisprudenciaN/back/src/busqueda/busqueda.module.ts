import { Module } from '@nestjs/common';
import { EstadisticasModule } from '../estadisticas/estadisticas.module';
import { IaModule } from '../ia/ia.module';
import { InstitutosJuridicosModule } from '../institutos-juridicos/institutos-juridicos.module';
import { BusquedaController, PublicBusquedaController } from './busqueda.controller';
import { BusquedaService } from './busqueda.service';
import { FederatedSearchService } from './federated-search.service';
import { PostgresJurisprudenciaSearchAdapter } from './adapters/postgres-jurisprudencia-search.adapter';
import { CorpusSearchSourceAdapter } from '../corpus/corpus-search.adapter';

@Module({
  imports: [EstadisticasModule, IaModule, InstitutosJuridicosModule],
  controllers: [BusquedaController, PublicBusquedaController],
  providers: [
    BusquedaService,
    {
      provide: FederatedSearchService,
      useFactory: () => {
        const raw = process.env.DATABASE_URL;
        if (!raw) return new FederatedSearchService(null, null);
        try {
          const url = new URL(raw);
          const isDev = url.protocol === 'postgresql:' && url.hostname === '127.0.0.1' && url.port === '55432' && url.pathname === '/buscador_juridico_civil_dev' && url.username === 'bjc_dev';
          return isDev
            ? new FederatedSearchService(new PostgresJurisprudenciaSearchAdapter(raw), new CorpusSearchSourceAdapter(raw))
            : new FederatedSearchService(null, null);
        } catch { return new FederatedSearchService(null, null); }
      },
    },
  ],
  exports: [BusquedaService],
})
export class BusquedaModule {}

import { Module } from '@nestjs/common';
import { CatalogosModule } from '../catalogos/catalogos.module';
import { EstadisticasModule } from '../estadisticas/estadisticas.module';
import { IaModule } from '../ia/ia.module';
import { LogsModule } from '../logs/logs.module';
import { PublicSentenciasController } from './public-sentencias.controller';
import { SentenciasController } from './sentencias.controller';
import { SentenciasService } from './sentencias.service';

@Module({
  imports: [CatalogosModule, EstadisticasModule, IaModule, LogsModule],
  controllers: [SentenciasController, PublicSentenciasController],
  providers: [SentenciasService],
  exports: [SentenciasService],
})
export class SentenciasModule {}

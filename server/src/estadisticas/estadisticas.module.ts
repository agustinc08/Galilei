import { Module } from '@nestjs/common';
import {
  EstadisticasController,
  PublicEventosController,
} from './estadisticas.controller';
import { EstadisticasService } from './estadisticas.service';
import { EventosConsultaService } from './eventos-consulta.service';

@Module({
  controllers: [EstadisticasController, PublicEventosController],
  providers: [EstadisticasService, EventosConsultaService],
  exports: [EstadisticasService, EventosConsultaService],
})
export class EstadisticasModule {}

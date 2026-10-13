import { Module } from '@nestjs/common';
import { EstadisticasModule } from '../estadisticas/estadisticas.module';
import { IaModule } from '../ia/ia.module';
import { LogsModule } from '../logs/logs.module';
import { ArchivosController, PublicArchivosController } from './archivos.controller';
import { ArchivosService } from './archivos.service';

@Module({
  imports: [EstadisticasModule, IaModule, LogsModule],
  controllers: [ArchivosController, PublicArchivosController],
  providers: [ArchivosService],
})
export class ArchivosModule {}

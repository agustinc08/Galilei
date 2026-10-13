import { Module } from '@nestjs/common';
import { BusquedasGuardadasController } from './busquedas-guardadas.controller';
import { BusquedasGuardadasService } from './busquedas-guardadas.service';

@Module({
  controllers: [BusquedasGuardadasController],
  providers: [BusquedasGuardadasService],
})
export class BusquedasGuardadasModule {}

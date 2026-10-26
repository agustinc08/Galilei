import { Module } from '@nestjs/common';
import { BusquedaModule } from '../busqueda/busqueda.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BusquedasGuardadasController } from './busquedas-guardadas.controller';
import { BusquedasGuardadasService } from './busquedas-guardadas.service';

@Module({
  imports: [BusquedaModule, PrismaModule],
  controllers: [BusquedasGuardadasController],
  providers: [BusquedasGuardadasService],
})
export class BusquedasGuardadasModule {}

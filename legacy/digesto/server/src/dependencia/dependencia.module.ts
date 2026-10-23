import { Module } from '@nestjs/common';
import { DependenciaController } from './dependencia.controller';
import { DependenciaService } from './dependencia.service';

@Module({
  controllers: [DependenciaController],
  providers: [DependenciaService]
})
export class DependenciaModule {}

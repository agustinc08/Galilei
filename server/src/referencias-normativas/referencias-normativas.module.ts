import { Module } from '@nestjs/common';
import { IaModule } from '../ia/ia.module';
import { LogsModule } from '../logs/logs.module';
import { ReferenciasNormativasController } from './referencias-normativas.controller';
import { ReferenciasNormativasService } from './referencias-normativas.service';

@Module({
  imports: [IaModule, LogsModule],
  controllers: [ReferenciasNormativasController],
  providers: [ReferenciasNormativasService],
})
export class ReferenciasNormativasModule {}

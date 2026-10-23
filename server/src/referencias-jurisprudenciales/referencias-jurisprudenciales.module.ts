import { Module } from '@nestjs/common';
import { LogsModule } from '../logs/logs.module';
import { ReferenciasJurisprudencialesController } from './referencias-jurisprudenciales.controller';
import { ReferenciasJurisprudencialesService } from './referencias-jurisprudenciales.service';

@Module({
  imports: [LogsModule],
  controllers: [ReferenciasJurisprudencialesController],
  providers: [ReferenciasJurisprudencialesService],
})
export class ReferenciasJurisprudencialesModule {}

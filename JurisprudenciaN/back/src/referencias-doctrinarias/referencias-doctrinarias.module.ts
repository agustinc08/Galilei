import { Module } from '@nestjs/common';
import { LogsModule } from '../logs/logs.module';
import { ReferenciasDoctrinariasController } from './referencias-doctrinarias.controller';
import { ReferenciasDoctrinariasService } from './referencias-doctrinarias.service';

@Module({
  imports: [LogsModule],
  controllers: [ReferenciasDoctrinariasController],
  providers: [ReferenciasDoctrinariasService],
})
export class ReferenciasDoctrinariasModule {}

import { Module } from '@nestjs/common';
import { LogsModule } from '../logs/logs.module';
import { InstitutosJuridicosController } from './institutos-juridicos.controller';
import { InstitutosJuridicosService } from './institutos-juridicos.service';

@Module({
  imports: [LogsModule],
  controllers: [InstitutosJuridicosController],
  providers: [InstitutosJuridicosService],
  exports: [InstitutosJuridicosService],
})
export class InstitutosJuridicosModule {}

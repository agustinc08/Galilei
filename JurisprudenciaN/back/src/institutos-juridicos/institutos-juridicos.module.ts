import { Module } from '@nestjs/common';
import { InstitutosJuridicosController } from './institutos-juridicos.controller';
import { InstitutosJuridicosService } from './institutos-juridicos.service';

@Module({
  controllers: [InstitutosJuridicosController],
  providers: [InstitutosJuridicosService],
  exports: [InstitutosJuridicosService],
})
export class InstitutosJuridicosModule {}

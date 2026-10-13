import { Module } from '@nestjs/common';
import { NormasController } from './normas.controller';
import { NormasService } from './normas.service';

@Module({
  controllers: [NormasController],
  providers: [NormasService],
  exports: [NormasService],
})
export class NormasModule {}

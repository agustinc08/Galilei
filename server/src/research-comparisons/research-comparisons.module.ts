import { Module } from '@nestjs/common';
import { LogsModule } from '../logs/logs.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ResearchComparisonsController } from './research-comparisons.controller';
import { ResearchComparisonsService } from './research-comparisons.service';

@Module({
  imports: [LogsModule, PrismaModule],
  controllers: [ResearchComparisonsController],
  providers: [ResearchComparisonsService],
})
export class ResearchComparisonsModule {}

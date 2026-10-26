import { Module } from '@nestjs/common';
import { LogsModule } from '../logs/logs.module';
import { PrismaModule } from '../prisma/prisma.module';
import {
  PublicEvolutionController,
  ResearchTimelinesController,
} from './research-timelines.controller';
import { ResearchTimelinesService } from './research-timelines.service';

@Module({
  imports: [LogsModule, PrismaModule],
  controllers: [PublicEvolutionController, ResearchTimelinesController],
  providers: [ResearchTimelinesService],
})
export class ResearchTimelinesModule {}

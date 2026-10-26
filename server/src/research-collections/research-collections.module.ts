import { Module } from '@nestjs/common';
import { LogsModule } from '../logs/logs.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ResearchCollectionsController } from './research-collections.controller';
import { ResearchCollectionsService } from './research-collections.service';

@Module({
  imports: [LogsModule, PrismaModule],
  controllers: [ResearchCollectionsController],
  providers: [ResearchCollectionsService],
})
export class ResearchCollectionsModule {}

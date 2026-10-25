import { Module } from '@nestjs/common';
import { ResearchCollectionsController } from './research-collections.controller';
import { ResearchCollectionsService } from './research-collections.service';

@Module({
  controllers: [ResearchCollectionsController],
  providers: [ResearchCollectionsService],
})
export class ResearchCollectionsModule {}

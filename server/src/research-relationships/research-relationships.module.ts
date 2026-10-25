import { Module } from '@nestjs/common';
import {
  PublicResearchRelationshipsController,
  ResearchRelationshipsController,
} from './research-relationships.controller';
import { ResearchRelationshipsService } from './research-relationships.service';

@Module({
  controllers: [
    ResearchRelationshipsController,
    PublicResearchRelationshipsController,
  ],
  providers: [ResearchRelationshipsService],
  exports: [ResearchRelationshipsService],
})
export class ResearchRelationshipsModule {}

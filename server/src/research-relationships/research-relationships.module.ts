import { Module } from '@nestjs/common';
import {
  PublicResearchRelationshipsController,
  ResearchRelationshipsController,
} from './research-relationships.controller';
import { SentenciasModule } from '../sentencias/sentencias.module';
import { ResearchRelationshipsService } from './research-relationships.service';

@Module({
  imports: [SentenciasModule],
  controllers: [
    ResearchRelationshipsController,
    PublicResearchRelationshipsController,
  ],
  providers: [ResearchRelationshipsService],
  exports: [ResearchRelationshipsService],
})
export class ResearchRelationshipsModule {}

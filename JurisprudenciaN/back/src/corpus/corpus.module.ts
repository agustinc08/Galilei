import { Module } from '@nestjs/common';
import { CorpusDocumentController, PublicCorpusDocumentController } from './corpus-document.controller';
import { CorpusDocumentAccessService } from './corpus-document-access.service';
import { CorpusCurationController } from './corpus-curation.controller';
import { CorpusCurationService } from './corpus-curation.service';

@Module({
  controllers: [CorpusDocumentController, PublicCorpusDocumentController, CorpusCurationController],
  providers: [CorpusDocumentAccessService, CorpusCurationService],
  exports: [CorpusDocumentAccessService],
})
export class CorpusModule {}

import { Module } from '@nestjs/common';
import { CorpusDocumentController, PublicCorpusDocumentController } from './corpus-document.controller';
import { CorpusDocumentAccessService } from './corpus-document-access.service';
import { CorpusCurationController } from './corpus-curation.controller';
import { CorpusCurationService } from './corpus-curation.service';
import { BusquedaModule } from '../busqueda/busqueda.module';
import { WorkspaceDocumentController } from './workspace-document.controller';
import { WorkspaceDocumentService } from './workspace-document.service';

@Module({
  imports: [BusquedaModule],
  controllers: [CorpusDocumentController, PublicCorpusDocumentController, CorpusCurationController, WorkspaceDocumentController],
  providers: [CorpusDocumentAccessService, CorpusCurationService, WorkspaceDocumentService],
  exports: [CorpusDocumentAccessService],
})
export class CorpusModule {}

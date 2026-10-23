import { Module } from '@nestjs/common';
import {
  CorpusDocumentController,
  PublicCorpusDocumentController,
} from './corpus-document.controller';
import { CorpusDocumentAccessService } from './corpus-document-access.service';
import { CorpusCurationController } from './corpus-curation.controller';
import { CorpusCurationService } from './corpus-curation.service';
import { BusquedaModule } from '../busqueda/busqueda.module';
import { WorkspaceDocumentController } from './workspace-document.controller';
import { WorkspaceDocumentService } from './workspace-document.service';
import { PersonalDocumentController } from './personal-document.controller';
import { DocumentSourceController } from './document-source.controller';
import { DocumentSourceService } from './document-source.service';
import { DocumentSourceScanner } from './document-source-scanner';
import { LocalPdfOcrProcessor } from './document-local-processors';
import { CorpusOcrWorkerService } from './corpus-ocr-worker.service';

@Module({
  imports: [BusquedaModule],
  controllers: [
    CorpusDocumentController,
    PublicCorpusDocumentController,
    CorpusCurationController,
    WorkspaceDocumentController,
    PersonalDocumentController,
    DocumentSourceController,
  ],
  providers: [
    CorpusDocumentAccessService,
    CorpusCurationService,
    WorkspaceDocumentService,
    DocumentSourceService,
    DocumentSourceScanner,
    CorpusOcrWorkerService,
    {
      provide: LocalPdfOcrProcessor,
      useFactory: () => new LocalPdfOcrProcessor(),
    },
  ],
  exports: [CorpusDocumentAccessService],
})
export class CorpusModule {}

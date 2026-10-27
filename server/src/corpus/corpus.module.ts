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
import { InstitutionalIngestionController } from './institutional-ingestion.controller';
import { InstitutionalIngestionService } from './institutional-ingestion.service';
import { LogsModule } from '../logs/logs.module';
import { OcrHumanReviewController } from './ocr-human-review.controller';
import { OcrHumanReviewService } from './ocr-human-review.service';

@Module({
  imports: [BusquedaModule, LogsModule],
  controllers: [
    CorpusDocumentController,
    PublicCorpusDocumentController,
    CorpusCurationController,
    WorkspaceDocumentController,
    PersonalDocumentController,
    DocumentSourceController,
    InstitutionalIngestionController,
    OcrHumanReviewController,
  ],
  providers: [
    CorpusDocumentAccessService,
    CorpusCurationService,
    WorkspaceDocumentService,
    DocumentSourceService,
    DocumentSourceScanner,
    CorpusOcrWorkerService,
    InstitutionalIngestionService,
    OcrHumanReviewService,
    {
      provide: LocalPdfOcrProcessor,
      useFactory: () => new LocalPdfOcrProcessor(),
    },
  ],
  exports: [CorpusDocumentAccessService],
})
export class CorpusModule {}

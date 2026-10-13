import { Module } from '@nestjs/common';
import { IaController } from './ia.controller';
import { IaService } from './ia.service';
import { EmbeddingsService } from './embeddings.service';
import { NormasDetectorService } from './normas-detector.service';
import { OllamaService } from './ollama.service';
import { PdfService } from './pdf.service';
import { RagService } from './rag.service';

@Module({
  controllers: [IaController],
  providers: [
    IaService,
    EmbeddingsService,
    NormasDetectorService,
    OllamaService,
    PdfService,
    RagService,
  ],
  exports: [
    IaService,
    EmbeddingsService,
    NormasDetectorService,
    OllamaService,
    PdfService,
    RagService,
  ],
})
export class IaModule {}

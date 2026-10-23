import { Injectable } from '@nestjs/common';
import { OllamaService } from './ollama.service';

@Injectable()
export class EmbeddingsService {
  constructor(private readonly ollamaService: OllamaService) {}

  async generarEmbedding(texto: string): Promise<number[]> {
    return this.ollamaService.embeddings(texto);
  }
}

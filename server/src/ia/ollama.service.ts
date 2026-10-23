import { Injectable, ServiceUnavailableException } from '@nestjs/common';

type GenerateResponse = {
  response?: string;
};

type EmbeddingResponse = {
  embedding?: number[];
  embeddings?: number[][];
};

@Injectable()
export class OllamaService {
  readonly baseUrl =
    process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_URL ?? 'http://localhost:11434';
  readonly generationModel =
    process.env.OLLAMA_GENERATION_MODEL ?? process.env.OLLAMA_MODEL ?? 'llama3';
  readonly embeddingModel =
    process.env.OLLAMA_EMBEDDING_MODEL ??
    process.env.OLLAMA_EMBEDDINGS_MODEL ??
    'nomic-embed-text';

  async health() {
    try {
      const response = await this.fetchWithTimeout('/api/tags', { method: 'GET' }, 4001);
      if (!response.ok) {
        return {
          ok: false,
          baseUrl: this.baseUrl,
          generationModel: this.generationModel,
          embeddingModel: this.embeddingModel,
          message: `Ollama respondio ${response.status}.`,
        };
      }

      return {
        ok: true,
        baseUrl: this.baseUrl,
        generationModel: this.generationModel,
        embeddingModel: this.embeddingModel,
        message: 'Ollama disponible.',
      };
    } catch {
      return {
        ok: false,
        baseUrl: this.baseUrl,
        generationModel: this.generationModel,
        embeddingModel: this.embeddingModel,
        message:
          'No se pudo conectar con Ollama. Verificá que esté corriendo en http://localhost:11434.',
      };
    }
  }

  async generate(prompt: string): Promise<string> {
    const response = await this.fetchWithTimeout(
      '/api/generate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.generationModel,
          prompt,
          stream: false,
          options: { temperature: 0.2 },
        }),
      },
      120000,
    ).catch(() => {
      throw this.ollamaUnavailable('generar la reseña');
    });

    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Ollama no pudo generar la reseña. Código: ${response.status}.`,
      );
    }

    const payload = (await response.json()) as GenerateResponse;
    return payload.response?.trim() ?? '';
  }

  async embeddings(text: string): Promise<number[]> {
    const input = text.trim();
    if (!input) {
      return [];
    }

    const response = await this.fetchWithTimeout(
      '/api/embeddings',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.embeddingModel,
          prompt: input,
        }),
      },
      30000,
    ).catch(() => {
      throw this.ollamaUnavailable('generar embeddings');
    });

    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Ollama no pudo generar embeddings. Codigo: ${response.status}.`,
      );
    }

    const payload = (await response.json()) as EmbeddingResponse;
    const embedding = payload.embedding ?? payload.embeddings?.[0] ?? [];
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new ServiceUnavailableException('Ollama no devolvio un embedding valido.');
    }

    return embedding;
  }

  private async fetchWithTimeout(path: string, init: RequestInit, timeoutMs: number) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private ollamaUnavailable(action: string) {
    return new ServiceUnavailableException(
      `No se pudo conectar con Ollama para ${action}. Verificá que esté corriendo en http://localhost:11434.`,
    );
  }
}

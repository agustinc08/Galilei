import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingsService } from './embeddings.service';
import { OllamaService } from './ollama.service';

export type DocumentoSimilar = {
  id: number;
  sentenciaId: number;
  fuente: string;
  fuenteId: number | null;
  textoResumen: string;
  similitud: number;
};

export type FalloSimilar = {
  id: number;
  numeroSentencia: string | null;
  caratula: string | null;
  sala: string | null;
  fecha: Date | null;
  temaPrincipal: string | null;
  scoreSimilitud: number;
  sumarioBreve: string | null;
};

@Injectable()
export class RagService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingsService: EmbeddingsService,
    private readonly ollamaService: OllamaService,
  ) {}

  async buscarSimilares(texto: string, top = 5): Promise<DocumentoSimilar[]> {
    const embedding = await this.embeddingsService.generarEmbedding(
      this.limitText(texto, 2000),
    );
    const documentos = await this.prisma.embeddingDocumento.findMany({
      select: {
        id: true,
        sentenciaId: true,
        fuente: true,
        fuenteId: true,
        textoResumen: true,
        embedding: true,
      },
    });

    return documentos
      .map((documento) => ({
        id: documento.id,
        sentenciaId: documento.sentenciaId,
        fuente: documento.fuente,
        fuenteId: documento.fuenteId,
        textoResumen: documento.textoResumen,
        similitud: this.cosineSimilarity(
          embedding,
          this.toNumberArray(documento.embedding),
        ),
      }))
      .filter((documento: DocumentoSimilar) =>
        Number.isFinite(documento.similitud),
      )
      .sort(
        (left: DocumentoSimilar, right: DocumentoSimilar) =>
          right.similitud - left.similitud,
      )
      .slice(0, top);
  }

  async buscarFallosSimilares(
    texto: string,
    limit = 10,
    excludeSentenciaId?: number,
  ) {
    try {
      const similares = await this.buscarSimilares(
        texto,
        Math.max(limit * 3, limit),
      );
      return this.enrichSimilares(
        similares.filter((item) => item.sentenciaId !== excludeSentenciaId),
        limit,
      );
    } catch {
      return [];
    }
  }

  async buscarFallosSimilaresPorSentencia(sentenciaId: number, limit = 10) {
    const sentencia = await this.prisma.sentencia.findUnique({
      where: { id: sentenciaId },
      include: {
        sumarios: { where: { activo: true }, orderBy: { id: 'asc' } },
      },
    });

    if (!sentencia) {
      return [];
    }

    const texto = [
      sentencia.objeto,
      sentencia.caratula,
      sentencia.actor,
      sentencia.demandado,
      sentencia.resena,
      ...sentencia.sumarios.map((sumario) =>
        [sumario.tema, sumario.texto].join(' '),
      ),
    ]
      .filter(Boolean)
      .join('\n');

    const porEmbedding = await this.buscarFallosSimilares(
      texto,
      limit,
      sentenciaId,
    );
    if (porEmbedding.length) {
      return porEmbedding;
    }

    return this.fallbackSimilares(sentenciaId, limit);
  }

  async generarResenaConRAG(
    textoFallo: string,
    datos: string[] = [],
    fallbackTextos: string[] = [],
  ) {
    const maxChars = Number(process.env.IA_MAX_CHARS ?? 30000);
    const textoLimitado = textoFallo.trim().slice(0, maxChars);
    const similares = await this.buscarSimilares(textoLimitado, 5).catch(
      (): DocumentoSimilar[] => [],
    );
    const contexto = similares.length
      ? similares
          .map(
            (item, index) =>
              `Ejemplo ${index + 1} (sentencia ${item.sentenciaId}, similitud ${item.similitud.toFixed(3)}):\n${item.textoResumen}`,
          )
          .join('\n\n')
      : fallbackTextos
          .map((item, index) => `Ejemplo textual ${index + 1}:\n${item}`)
          .join('\n\n');

    const prompt = [
      'Sos un asistente jurídico argentino especializado en jurisprudencia civil.',
      'Redactá una reseña objetiva, clara y breve del fallo.',
      'No inventes datos.',
      'No cites normas o precedentes que no surjan del texto.',
      'No opines.',
      'Explicá: 1. conflicto o cuestión tratada; 2. decisión adoptada; 3. criterio jurídico relevante.',
      'Máximo 250 palabras.',
      'Lenguaje formal, apto para Secretaría de Jurisprudencia.',
      datos.length
        ? `Datos de sentencia:\n${datos.filter(Boolean).join('\n')}`
        : '',
      'Estos son fallos similares y sus sumarios:',
      contexto || 'No hay ejemplos similares disponibles.',
      'Ahora generá una reseña para este nuevo fallo:',
      textoLimitado,
    ].join('\n\n');

    return {
      resena: await this.ollamaService.generate(prompt),
      documentos: similares,
    };
  }

  async enrichSimilares(
    similares: DocumentoSimilar[],
    limit = 10,
  ): Promise<FalloSimilar[]> {
    const bestBySentencia = new Map<number, DocumentoSimilar>();
    for (const item of similares) {
      const current = bestBySentencia.get(item.sentenciaId);
      if (!current || item.similitud > current.similitud) {
        bestBySentencia.set(item.sentenciaId, item);
      }
    }

    const ids = [...bestBySentencia.keys()].slice(0, limit);
    if (!ids.length) {
      return [];
    }

    const sentencias = await this.prisma.sentencia.findMany({
      where: { id: { in: ids }, activo: true },
      include: {
        sumarios: { where: { activo: true }, orderBy: { id: 'asc' }, take: 1 },
      },
    });

    return sentencias
      .map((sentencia) => {
        const best = bestBySentencia.get(sentencia.id);
        const sumario = sentencia.sumarios[0];
        return {
          id: sentencia.id,
          numeroSentencia: sentencia.numeroSentencia,
          caratula: sentencia.caratula,
          sala: sentencia.sala,
          fecha: sentencia.fecha,
          temaPrincipal: sumario?.tema ?? sentencia.objeto,
          scoreSimilitud: best?.similitud ?? 0,
          sumarioBreve: sumario?.texto
            ? this.limitText(sumario.texto, 45)
            : best?.textoResumen
              ? this.limitText(best.textoResumen, 45)
              : null,
        };
      })
      .sort((left, right) => right.scoreSimilitud - left.scoreSimilitud)
      .slice(0, limit);
  }

  async fallbackSimilares(
    sentenciaId: number,
    limit = 10,
  ): Promise<FalloSimilar[]> {
    const sentencia = await this.prisma.sentencia.findUnique({
      where: { id: sentenciaId },
      select: { id: true, sala: true, objeto: true, tipoFallo: true },
    });
    if (!sentencia) {
      return [];
    }

    const or: Prisma.SentenciaWhereInput[] = [];
    if (sentencia.sala) or.push({ sala: sentencia.sala });
    if (sentencia.objeto) {
      or.push({
        objeto: { contains: sentencia.objeto, mode: 'insensitive' },
      });
    }
    if (sentencia.tipoFallo) or.push({ tipoFallo: sentencia.tipoFallo });

    if (!or.length) {
      return [];
    }

    const similares = await this.prisma.sentencia.findMany({
      where: { id: { not: sentenciaId }, activo: true, OR: or },
      include: {
        sumarios: { where: { activo: true }, orderBy: { id: 'asc' }, take: 1 },
      },
      orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
      take: limit,
    });

    return similares.map((item) => ({
      id: item.id,
      numeroSentencia: item.numeroSentencia,
      caratula: item.caratula,
      sala: item.sala,
      fecha: item.fecha,
      temaPrincipal: item.sumarios[0]?.tema ?? item.objeto,
      scoreSimilitud: 0,
      sumarioBreve: item.sumarios[0]?.texto
        ? this.limitText(item.sumarios[0].texto, 45)
        : null,
    }));
  }

  private toNumberArray(value: unknown): number[] {
    return Array.isArray(value)
      ? value
          .map((item) => Number(item))
          .filter((item) => Number.isFinite(item))
      : [];
  }

  private cosineSimilarity(left: number[], right: number[]) {
    if (!left.length || left.length !== right.length) {
      return 0;
    }

    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;

    for (let index = 0; index < left.length; index += 1) {
      dot += left[index] * right[index];
      leftNorm += left[index] * left[index];
      rightNorm += right[index] * right[index];
    }

    if (!leftNorm || !rightNorm) {
      return 0;
    }

    return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
  }

  private limitText(text: string, words: number) {
    return text.trim().split(/\s+/).slice(0, words).join(' ');
  }
}

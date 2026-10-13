import { Injectable, Logger } from '@nestjs/common';
import { archivoPdfEsReal } from '../archivos/pdf-real.util';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingsService } from './embeddings.service';
import { PdfService } from './pdf.service';
import { RagService } from './rag.service';

@Injectable()
export class IaService {
  private readonly logger = new Logger(IaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdfService: PdfService,
    private readonly embeddingsService: EmbeddingsService,
    private readonly ragService: RagService,
  ) {}

  async indexarSentencia(sentenciaId: number) {
    const sentencia = await this.prisma.sentencia.findUnique({
      where: { id: sentenciaId },
      include: {
        sumarios: { where: { activo: true }, orderBy: { id: 'asc' } },
        archivosPdf: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!sentencia) {
      return { data: { indexed: 0 } };
    }

    let indexed = 0;
    for (const sumario of sentencia.sumarios) {
      const exists = await (this.prisma as any).embeddingDocumento.findUnique({
        where: {
          sentenciaId_fuente_fuenteId: {
            sentenciaId,
            fuente: 'SUMARIO',
            fuenteId: sumario.id,
          },
        },
      });
      if (exists) {
        continue;
      }
      const texto = [sumario.tema, sumario.texto].filter(Boolean).join('\n');
      const embedding = await this.embeddingsService.generarEmbedding(texto);
      await (this.prisma as any).embeddingDocumento.create({
        data: {
          sentenciaId,
          fuente: 'SUMARIO',
          fuenteId: sumario.id,
          textoResumen: this.limitText(texto, 500),
          embedding,
        },
      });
      indexed += 1;
    }

    const archivo = sentencia.archivosPdf.find((item) => archivoPdfEsReal(item));
    if (archivo) {
      const exists = await (this.prisma as any).embeddingDocumento.findUnique({
        where: {
          sentenciaId_fuente_fuenteId: {
            sentenciaId,
            fuente: 'PDF_FRAGMENTO',
            fuenteId: archivo.id,
          },
        },
      });
      if (!exists) {
        const textoPdf = await this.pdfService.extraerTexto(archivo.rutaArchivo);
        const fragmento = this.limitText(textoPdf, 1200);
        if (fragmento) {
          const embedding = await this.embeddingsService.generarEmbedding(fragmento);
          await (this.prisma as any).embeddingDocumento.create({
            data: {
              sentenciaId,
              fuente: 'PDF_FRAGMENTO',
              fuenteId: archivo.id,
              textoResumen: fragmento,
              embedding,
            },
          });
          indexed += 1;
        }
      }
    }

    return { data: { indexed } };
  }

  async generarResenaSugerida(sentenciaId: number) {
    const sentencia = await this.prisma.sentencia.findUnique({
      where: { id: sentenciaId },
      include: {
        sumarios: { where: { activo: true }, orderBy: { id: 'asc' } },
        archivosPdf: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!sentencia) {
      return { data: { resenaIa: '', similares: [], advertencias: ['Sentencia no encontrada.'] } };
    }

    const advertencias: string[] = [];
    const archivo = sentencia.archivosPdf.find((item) => archivoPdfEsReal(item));
    let texto = '';

    if (archivo) {
      texto = await this.pdfService.extraerTexto(archivo.rutaArchivo);
    } else {
      advertencias.push('La sentencia no tiene PDF disponible; se usaron datos cargados y sumarios.');
      texto = [
        sentencia.caratula,
        sentencia.actor,
        sentencia.demandado,
        sentencia.objeto,
        sentencia.magistrados,
        sentencia.resena,
        ...sentencia.sumarios.map((sumario) => [sumario.tema, sumario.texto].join('\n')),
      ]
        .filter(Boolean)
        .join('\n\n');
    }

    if (!texto.trim()) {
      return {
        data: {
          resenaIa: '',
          similares: [],
          advertencias: ['No hay texto suficiente para generar una reseña.'],
        },
      };
    }

    const datos = [
      sentencia.numeroSentencia ? `Número: ${sentencia.numeroSentencia}` : '',
      sentencia.sala ? `Sala: ${sentencia.sala}` : '',
      sentencia.tipoFallo ? `Tipo de fallo: ${sentencia.tipoFallo}` : '',
      sentencia.fecha ? `Fecha: ${sentencia.fecha.toISOString().slice(0, 10)}` : '',
      sentencia.caratula ? `Carátula: ${sentencia.caratula}` : '',
      sentencia.objeto ? `Objeto: ${sentencia.objeto}` : '',
      sentencia.sumarios.length
        ? `Sumarios:\n${sentencia.sumarios
            .map((sumario) => `- ${sumario.tema ?? 'Sin tema'}: ${sumario.texto}`)
            .join('\n')}`
        : '',
    ];

    const fallbackSimilares = await this.ragService.fallbackSimilares(sentenciaId, 5);
    const fallbackContexto = fallbackSimilares
      .map((item) =>
        [
          item.numeroSentencia ? `Sentencia ${item.numeroSentencia}` : '',
          item.caratula ? `Caratula: ${item.caratula}` : '',
          item.temaPrincipal ? `Tema: ${item.temaPrincipal}` : '',
          item.sumarioBreve ? `Sumario: ${item.sumarioBreve}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      )
      .filter(Boolean);

    const result = await this.ragService.generarResenaConRAG(texto, datos, fallbackContexto);
    const similaresPorEmbedding = await this.ragService.enrichSimilares(result.documentos, 5);
    const similares = similaresPorEmbedding.length ? similaresPorEmbedding : fallbackSimilares;

    await this.prisma.sentencia.update({
      where: { id: sentenciaId },
      data: {
        resenaAi: result.resena,
      },
    });

    return {
      data: {
        resenaIa: result.resena,
        resenaAi: result.resena,
        resena: result.resena,
        similares,
        documentos: result.documentos,
        advertencias,
      },
    };
  }

  async buscarSimilares(sentenciaId: number, limit = 10) {
    const similares = await this.ragService.buscarFallosSimilaresPorSentencia(
      sentenciaId,
      limit,
    );
    return { data: similares };
  }

  async buscarSimilaresPublicos(sentenciaId: number, limit = 5) {
    const similares = await this.ragService.buscarFallosSimilaresPorSentencia(
      sentenciaId,
      Math.max(limit * 3, limit),
    );
    const ids = similares.map((item) => item.id);
    if (!ids.length) {
      return { data: [] };
    }

    const publicas = await this.prisma.sentencia.findMany({
      where: { id: { in: ids }, publicado: true, activo: true },
      select: { id: true, slugPublico: true },
    });
    const publicIds = new Set(publicas.map((item) => item.id));
    const slugById = new Map(publicas.map((item) => [item.id, item.slugPublico]));

    return {
      data: similares
        .filter((item) => publicIds.has(item.id))
        .slice(0, limit)
        .map((item) => ({ ...item, slugPublico: slugById.get(item.id) ?? null })),
    };
  }

  generarResenaSugeridaAsync(sentenciaId: number) {
    void this.generarResenaSugerida(sentenciaId).catch((error) => {
      this.logger.warn(
        `No se pudo generar reseña RAG para sentencia ${sentenciaId}: ${String(error)}`,
      );
    });
  }

  private limitText(text: string, words: number) {
    return text.trim().split(/\s+/).slice(0, words).join(' ');
  }
}

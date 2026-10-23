import 'dotenv/config';

import { readFile } from 'fs/promises';
import { PDFParse } from 'pdf-parse';
import { createPrismaClient } from '../src/importacion/utils/prisma-client';
import { archivoPdfEsReal } from '../src/archivos/pdf-real.util';

const OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_URL ?? 'http://localhost:11434';
const EMBEDDINGS_MODEL =
  process.env.OLLAMA_EMBEDDING_MODEL ??
  process.env.OLLAMA_EMBEDDINGS_MODEL ??
  'nomic-embed-text';
const BATCH_SIZE = Number(process.env.RAG_INDEX_BATCH_SIZE ?? 25);
const DRY_RUN = process.argv.includes('--dry-run');

async function generarEmbedding(texto: string) {
  const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: EMBEDDINGS_MODEL,
      prompt: texto,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama embeddings respondio ${response.status}`);
  }

  const payload = (await response.json()) as { embedding?: number[] };
  if (!payload.embedding?.length) {
    throw new Error('Ollama no devolvio embedding.');
  }
  return payload.embedding;
}

async function extraerTexto(pdfPath: string) {
  const buffer = await readFile(pdfPath);
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text.replace(/\s+/g, ' ').trim();
  } finally {
    await parser.destroy();
  }
}

function limitar(texto: string, words: number) {
  return texto.trim().split(/\s+/).slice(0, words).join(' ');
}

async function main() {
  const prisma = createPrismaClient();
  let indexed = 0;
  let skipped = 0;
  let cursor: number | undefined;

  try {
    if (DRY_RUN) {
      const [sentencias, embeddings] = await Promise.all([
        prisma.sentencia.count(),
        (prisma as any).embeddingDocumento.count(),
      ]);
      console.log(
        `Dry-run IA/RAG. Sentencias=${sentencias} embeddingsExistentes=${embeddings} modelo=${EMBEDDINGS_MODEL} ollama=${OLLAMA_URL}`,
      );
      return;
    }

    for (;;) {
      const sentencias = await prisma.sentencia.findMany({
        take: BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
        include: {
          sumarios: { where: { activo: true }, orderBy: { id: 'asc' } },
          archivosPdf: { orderBy: { createdAt: 'desc' } },
        },
      });

      if (!sentencias.length) {
        break;
      }

      for (const sentencia of sentencias) {
        for (const sumario of sentencia.sumarios) {
          const exists = await (prisma as any).embeddingDocumento.findUnique({
            where: {
              sentenciaId_fuente_fuenteId: {
                sentenciaId: sentencia.id,
                fuente: 'SUMARIO',
                fuenteId: sumario.id,
              },
            },
          });

          if (exists) {
            skipped += 1;
            continue;
          }

          const texto = [sumario.tema, sumario.texto].filter(Boolean).join('\n');
          const embedding = await generarEmbedding(texto);
          await (prisma as any).embeddingDocumento.create({
            data: {
              sentenciaId: sentencia.id,
              fuente: 'SUMARIO',
              fuenteId: sumario.id,
              textoResumen: limitar(texto, 500),
              embedding,
            },
          });
          indexed += 1;
        }

        const archivo = sentencia.archivosPdf.find((item) => archivoPdfEsReal(item));
        if (archivo) {
          const exists = await (prisma as any).embeddingDocumento.findUnique({
            where: {
              sentenciaId_fuente_fuenteId: {
                sentenciaId: sentencia.id,
                fuente: 'PDF_FRAGMENTO',
                fuenteId: archivo.id,
              },
            },
          });

          if (exists) {
            skipped += 1;
          } else {
            const textoPdf = await extraerTexto(archivo.rutaArchivo);
            const fragmento = limitar(textoPdf, 1200);
            if (fragmento) {
              const embedding = await generarEmbedding(fragmento);
              await (prisma as any).embeddingDocumento.create({
                data: {
                  sentenciaId: sentencia.id,
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
      }

      cursor = sentencias[sentencias.length - 1].id;
      console.log(`Indexados=${indexed} omitidos=${skipped} ultimoId=${cursor}`);
    }

    console.log(`Finalizado. Indexados=${indexed} omitidos=${skipped}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

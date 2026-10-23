import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { basename, extname, resolve } from 'path';
import { EventosConsultaService } from '../estadisticas/eventos-consulta.service';
import { LogsService } from '../logs/logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { CorpusIngestionService } from '../corpus/corpus-ingestion.service';
import { BasicDocumentTextExtractor } from '../corpus/document-text-extractor';
import { LocalDocumentStorageAdapter } from '../corpus/document-storage.adapter';
import { archivoPdfEsReal } from './pdf-real.util';

@Injectable()
export class ArchivosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventosConsultaService: EventosConsultaService,
    private readonly logsService: LogsService,
  ) {}

  async uploadSentenciaPdf(
    sentenciaId: number,
    file?: Express.Multer.File,
    usuarioId?: number,
  ) {
    if (!file) {
      throw new BadRequestException('Debe adjuntar un archivo PDF');
    }

    await this.ensureSentenciaExists(sentenciaId);
    const checksum = this.validatePdfEnvelope(file);
    const duplicate = await this.prisma.corpusDocumentFile.findFirst({
      where: { sha256: checksum, document: { documentScope: 'GENERAL' } },
      select: { documentId: true },
    });
    if (duplicate)
      throw new ConflictException('Este archivo ya fue incorporado.');
    await this.ensurePdfReadable(file);
    const storage = new LocalDocumentStorageAdapter();
    const pipeline = new CorpusIngestionService(
      this.prisma,
      storage,
      new BasicDocumentTextExtractor(),
    );
    const uploadedAt = new Date();
    const ingestion = await pipeline.ingestOne(
      {
        filename: basename(file.originalname),
        sourcePath: `manual-upload/${randomUUID()}`,
        sourceReference: `Carga manual de Jurisprudencia para sentencia ${sentenciaId}`,
        obtainedAt: uploadedAt,
        content: file.buffer,
        mimeType: 'application/pdf',
        documentType: 'JUDGMENT',
        jurisdiction: 'CIVIL',
        visibility: 'INTERNAL',
        metadata: {
          intakeChannel: 'MANUAL_JURISPRUDENCIA',
          uploadedByUserId: usuarioId ?? null,
        },
        metadataOriginal: {
          originalFilename: basename(file.originalname),
          sha256: checksum,
          uploadedByUserId: usuarioId ?? null,
          uploadedAt: uploadedAt.toISOString(),
        },
      },
      {
        sourceCode: 'MANUAL_JURISPRUDENCIA',
        sourceName: 'Carga manual de Jurisprudencia',
        sourceType: 'MANUAL',
      },
    );
    const corpusFile = await this.prisma.corpusDocumentFile.findUniqueOrThrow({
      where: {
        documentId_sha256: {
          documentId: ingestion.documentId,
          sha256: checksum,
        },
      },
      select: { storageKey: true },
    });
    const absolutePath = resolve(storage.root, corpusFile.storageKey);
    const { archivo } = await this.prisma.$transaction(async (tx) => {
      const archivo = await tx.archivoPdf.create({
        data: {
          nombreArchivo: `${checksum}.pdf`,
          nombreOriginal: basename(file.originalname),
          rutaArchivo: absolutePath,
          mimeType: 'application/pdf',
          tamanioBytes: file.size,
          sentenciaId,
        },
      });
      await tx.sentencia.update({
        where: { id: sentenciaId },
        data: { tienePdf: true },
      });
      await tx.corpusDocumentLink.create({
        data: {
          documentId: ingestion.documentId,
          targetDomain: 'JURISPRUDENCIA',
          targetType: 'SENTENCIA',
          targetId: String(sentenciaId),
          relationship: 'ASSOCIATED_WITH',
          metadata: {
            intakeChannel: 'MANUAL_JURISPRUDENCIA',
            uploadedByUserId: usuarioId ?? null,
          },
        },
      });
      return { archivo };
    });

    if (usuarioId) {
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'PDF',
        entidadId: archivo.id,
        accion: 'UPLOAD',
        descripcion: 'Incorporó un PDF al archivo documental de la sentencia',
        datosDespues: {
          archivoPdfId: archivo.id,
          documentId: ingestion.documentId,
          checksum,
          status: ingestion.status,
        },
      });
    }

    return { data: { ...archivo, status: ingestion.status } };
  }

  async uploadJurisprudenciaDraft(
    file?: Express.Multer.File,
    usuarioId?: number,
  ) {
    if (!file || !usuarioId)
      throw new BadRequestException('Debe adjuntar un archivo PDF.');
    const checksum = this.validatePdfEnvelope(file);
    const duplicate = await this.prisma.corpusDocumentFile.findFirst({
      where: { sha256: checksum, document: { documentScope: 'GENERAL' } },
      select: {
        documentId: true,
        document: {
          select: {
            title: true,
            links: {
              where: {
                targetDomain: 'JURISPRUDENCIA',
                targetType: 'SENTENCIA',
                relationship: 'ASSOCIATED_WITH',
              },
              select: { targetId: true },
              take: 1,
            },
          },
        },
      },
    });
    if (duplicate) {
      throw new ConflictException({
        message: 'Este archivo ya fue incorporado.',
        existingDocumentId: duplicate.documentId,
        existingSentenceId: duplicate.document.links[0]?.targetId ?? null,
      });
    }
    await this.ensurePdfReadable(file);

    const storage = new LocalDocumentStorageAdapter();
    const pipeline = new CorpusIngestionService(
      this.prisma,
      storage,
      new BasicDocumentTextExtractor(),
    );
    const uploadedAt = new Date();
    const ingestion = await pipeline.ingestOne(
      {
        filename: basename(file.originalname),
        sourcePath: `manual-upload/${randomUUID()}`,
        sourceReference: 'Carga manual de Jurisprudencia',
        obtainedAt: uploadedAt,
        content: file.buffer,
        mimeType: 'application/pdf',
        title: 'Borrador de fallo',
        documentType: 'JUDGMENT',
        jurisdiction: 'CIVIL',
        visibility: 'INTERNAL',
        metadata: {
          intakeChannel: 'MANUAL_JURISPRUDENCIA',
          uploadedByUserId: usuarioId,
        },
        metadataOriginal: {
          originalFilename: basename(file.originalname),
          sha256: checksum,
          uploadedByUserId: usuarioId,
          uploadedAt: uploadedAt.toISOString(),
        },
      },
      {
        sourceCode: 'MANUAL_JURISPRUDENCIA',
        sourceName: 'Carga manual de Jurisprudencia',
        sourceType: 'MANUAL',
      },
    );
    if (ingestion.status === 'INVALID_PDF')
      throw new BadRequestException('No pudimos procesar este archivo.');

    const corpusFile = await this.prisma.corpusDocumentFile.findUniqueOrThrow({
      where: {
        documentId_sha256: {
          documentId: ingestion.documentId,
          sha256: checksum,
        },
      },
      select: { storageKey: true, pageCount: true },
    });
    const absolutePath = resolve(storage.root, corpusFile.storageKey);
    const { sentence, archivo } = await this.prisma.$transaction(async (tx) => {
      const sentence = await tx.sentencia.create({
        data: {
          publicado: false,
          activo: true,
          estadoCarga: 'BORRADOR',
          tienePdf: true,
        },
      });
      const archivo = await tx.archivoPdf.create({
        data: {
          nombreArchivo: `${checksum}.pdf`,
          nombreOriginal: basename(file.originalname),
          rutaArchivo: absolutePath,
          mimeType: 'application/pdf',
          tamanioBytes: file.size,
          sentenciaId: sentence.id,
        },
      });
      await tx.corpusDocumentLink.create({
        data: {
          documentId: ingestion.documentId,
          targetDomain: 'JURISPRUDENCIA',
          targetType: 'SENTENCIA',
          targetId: String(sentence.id),
          relationship: 'ASSOCIATED_WITH',
          metadata: {
            intakeChannel: 'MANUAL_JURISPRUDENCIA',
            uploadedByUserId: usuarioId,
          },
        },
      });
      return { sentence, archivo };
    });
    await this.logsService.registrarAccion({
      usuarioId,
      entidad: 'SENTENCIA',
      entidadId: sentence.id,
      accion: 'CREATE_DRAFT',
      descripcion: 'Creó un borrador desde una carga manual de PDF',
      datosDespues: {
        sentenciaId: sentence.id,
        documentId: ingestion.documentId,
        archivoPdfId: archivo.id,
        checksum,
        status: ingestion.status,
      },
    });
    return {
      data: {
        sentenciaId: sentence.id,
        archivoPdfId: archivo.id,
        status: ingestion.status,
        pageCount: corpusFile.pageCount,
        textAvailable: ingestion.status === 'INDEXED',
        duplicateSha256: false,
      },
    };
  }

  async findBySentencia(sentenciaId: number) {
    await this.ensureSentenciaExists(sentenciaId);

    const data = await this.prisma.archivoPdf.findMany({
      where: { sentenciaId },
      orderBy: { createdAt: 'desc' },
    });

    return { data };
  }

  async findOne(id: number) {
    const archivo = await this.prisma.archivoPdf.findUnique({
      where: { id },
      include: {
        sentencia: {
          select: {
            id: true,
            numeroSentencia: true,
            expediente: true,
            sala: true,
            fecha: true,
          },
        },
      },
    });

    if (!archivo) {
      throw new NotFoundException('Archivo PDF no encontrado');
    }

    return { data: archivo };
  }

  async getDownload(id: number, usuarioId?: number) {
    const { data: archivo } = await this.findOne(id);

    if (!existsSync(archivo.rutaArchivo)) {
      throw new NotFoundException('El archivo fisico no existe en disco');
    }

    this.eventosConsultaService.trackSafe({
      tipoEvento: 'download_pdf',
      usuarioId,
      sentenciaId: archivo.sentenciaId,
      metadata: { archivoId: archivo.id },
    });

    return {
      archivo,
      absolutePath: archivo.rutaArchivo,
    };
  }

  async getPublicPdfByIdentifier(identifier: string) {
    const numericId = Number(identifier);
    const sentencia = await this.prisma.sentencia.findFirst({
      where: {
        publicado: true,
        activo: true,
        OR: [
          { slugPublico: identifier },
          ...(Number.isInteger(numericId) && numericId > 0
            ? [{ id: numericId }]
            : []),
        ],
      },
      select: {
        id: true,
        slugPublico: true,
        archivosPdf: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!sentencia) {
      throw new NotFoundException('Sentencia pública no encontrada');
    }

    const archivo = sentencia.archivosPdf.find((item) =>
      archivoPdfEsReal(item),
    );
    if (!archivo) {
      throw new NotFoundException(
        'La sentencia pública no tiene PDF disponible',
      );
    }

    this.eventosConsultaService.trackSafe({
      tipoEvento: 'download_pdf',
      sentenciaId: sentencia.id,
      metadata: { archivoId: archivo.id, scope: 'public-slug' },
    });

    return {
      archivo,
      absolutePath: archivo.rutaArchivo,
    };
  }

  remove(id: number, usuarioId?: number) {
    void id;
    void usuarioId;
    throw new ConflictException(
      'Los PDFs de jurisprudencia se conservan para mantener su procedencia. Archiva el fallo para retirarlo de consulta.',
    );
  }

  private async ensureSentenciaExists(sentenciaId: number) {
    const sentencia = await this.prisma.sentencia.findUnique({
      where: { id: sentenciaId },
      select: { id: true },
    });

    if (!sentencia) {
      throw new NotFoundException('Sentencia no encontrada');
    }
  }

  private validatePdfEnvelope(file: Express.Multer.File) {
    const extension = extname(file.originalname).toLowerCase();
    if (
      !file.buffer ||
      file.size <= 0 ||
      file.size > 100 * 1024 * 1024 ||
      file.mimetype !== 'application/pdf' ||
      extension !== '.pdf'
    ) {
      throw new BadRequestException(
        'El archivo debe ser un PDF válido de hasta 100 MB.',
      );
    }
    if (file.buffer.subarray(0, 5).toString('ascii') !== '%PDF-')
      throw new BadRequestException(
        'El archivo no contiene una firma PDF válida.',
      );
    return createHash('sha256').update(file.buffer).digest('hex');
  }

  private async ensurePdfReadable(file: Express.Multer.File) {
    try {
      await new BasicDocumentTextExtractor().extract(
        file.originalname,
        file.mimetype,
        file.buffer,
      );
    } catch {
      throw new BadRequestException('No pudimos procesar este archivo.');
    }
  }
}

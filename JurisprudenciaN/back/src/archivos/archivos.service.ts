import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { extname, join, resolve } from 'path';
import { EventosConsultaService } from '../estadisticas/eventos-consulta.service';
import { IaService } from '../ia/ia.service';
import { LogsService } from '../logs/logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { archivoPdfEsReal, sentenciaTienePdfReal } from './pdf-real.util';

const uploadDir = resolve(process.cwd(), 'uploads', 'sentencias');

@Injectable()
export class ArchivosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventosConsultaService: EventosConsultaService,
    private readonly logsService: LogsService,
    private readonly iaService: IaService,
  ) {}

  async uploadSentenciaPdf(sentenciaId: number, file?: Express.Multer.File, usuarioId?: number) {
    if (!file) {
      throw new BadRequestException('Debe adjuntar un archivo PDF');
    }

    await this.ensureSentenciaExists(sentenciaId);
    this.validatePdf(file);

    await mkdir(uploadDir, { recursive: true });

    const safeName = `${sentenciaId}-${Date.now()}-${randomUUID()}.pdf`;
    const absolutePath = join(uploadDir, safeName);
    await writeFile(absolutePath, file.buffer);

    const archivo = await this.prisma.archivoPdf.create({
      data: {
        nombreArchivo: safeName,
        nombreOriginal: file.originalname,
        rutaArchivo: absolutePath,
        mimeType: file.mimetype,
        tamanioBytes: file.size,
        sentenciaId,
      },
    });

    await this.prisma.sentencia.update({
      where: { id: sentenciaId },
      data: { tienePdf: true },
    });

    if (usuarioId) {
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'PDF',
        entidadId: archivo.id,
        accion: 'UPLOAD',
        descripcion: 'Subió PDF de sentencia',
        datosDespues: archivo,
      });
    }

    this.iaService.generarResenaSugeridaAsync(sentenciaId);

    return { data: archivo };
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
          ...(Number.isInteger(numericId) && numericId > 0 ? [{ id: numericId }] : []),
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

    const archivo = sentencia.archivosPdf.find((item) => archivoPdfEsReal(item));
    if (!archivo) {
      throw new NotFoundException('La sentencia pública no tiene PDF disponible');
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

  async remove(id: number, usuarioId?: number) {
    const { data: archivo } = await this.findOne(id);

    await this.prisma.archivoPdf.delete({ where: { id } });

    if (existsSync(archivo.rutaArchivo)) {
      await unlink(archivo.rutaArchivo);
    }

    const remaining = await this.prisma.archivoPdf.findMany({
      where: { sentenciaId: archivo.sentenciaId },
      select: { id: true, rutaArchivo: true },
    });

    await this.prisma.sentencia.update({
      where: { id: archivo.sentenciaId },
      data: { tienePdf: sentenciaTienePdfReal(remaining).disponible },
    });

    if (usuarioId) {
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'PDF',
        entidadId: id,
        accion: 'DELETE',
        descripcion: 'Eliminó PDF',
        datosAntes: archivo,
      });
    }

    return { data: { deleted: true } };
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

  private validatePdf(file: Express.Multer.File) {
    const extension = extname(file.originalname).toLowerCase();

    if (file.mimetype !== 'application/pdf' || extension !== '.pdf') {
      throw new BadRequestException('Solo se permiten archivos PDF');
    }
  }
}

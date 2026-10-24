import { Injectable, NotFoundException } from '@nestjs/common';
import { archivoPdfEsReal } from '../archivos/pdf-real.util';
import { NormasDetectorService } from '../ia/normas-detector.service';
import { PdfService } from '../ia/pdf.service';
import { LogsService } from '../logs/logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReferenciaNormativaDto } from './dto/create-referencia-normativa.dto';
import { UpdateReferenciaNormativaDto } from './dto/update-referencia-normativa.dto';

@Injectable()
export class ReferenciasNormativasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly normasDetectorService: NormasDetectorService,
    private readonly pdfService: PdfService,
    private readonly logsService: LogsService,
  ) {}

  async findBySentencia(sentenciaId: number) {
    await this.ensureSentenciaExists(sentenciaId);
    const data = await this.prisma.referenciaNormativa.findMany({
      where: { sentenciaId },
      orderBy: [{ tipoNorma: 'asc' }, { id: 'desc' }],
    });
    return { data };
  }

  async create(
    sentenciaId: number,
    dto: CreateReferenciaNormativaDto,
    usuarioId?: number,
  ) {
    await this.ensureSentenciaExists(sentenciaId);
    const norma = dto.normaArticuloId
      ? await this.prisma.normaArticulo.findUnique({
          where: { id: dto.normaArticuloId },
        })
      : null;
    const data = await this.prisma.referenciaNormativa.create({
      data: {
        sentenciaId,
        normaArticuloId: dto.normaArticuloId,
        tipoNorma: norma?.codigo ?? dto.tipoNorma,
        numeroNorma: norma?.numeroNorma ?? dto.numeroNorma,
        articulo: norma?.articulo ?? dto.articulo,
        inciso: dto.inciso,
        textoReferencia: norma?.texto ?? dto.textoReferencia,
        url: norma?.url ?? dto.url,
      },
    });

    if (usuarioId) {
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'REFERENCIA',
        entidadId: data.id,
        accion: 'CREATE',
        descripcion: 'Creó referencia normativa',
        datosDespues: data,
      });
    }
    return { data };
  }

  async update(
    id: number,
    dto: UpdateReferenciaNormativaDto,
    usuarioId?: number,
  ) {
    const before = await this.ensureExists(id);
    const data = await this.prisma.referenciaNormativa.update({
      where: { id },
      data: dto,
    });
    if (usuarioId) {
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'REFERENCIA',
        entidadId: id,
        accion: 'UPDATE',
        descripcion: 'Editó referencia normativa',
        datosAntes: before,
        datosDespues: data,
      });
    }
    return { data };
  }

  async remove(id: number, usuarioId?: number) {
    const before = await this.ensureExists(id);
    await this.prisma.referenciaNormativa.delete({ where: { id } });
    if (usuarioId) {
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'REFERENCIA',
        entidadId: id,
        accion: 'DELETE',
        descripcion: 'Eliminó referencia normativa',
        datosAntes: before,
      });
    }
    return { data: { deleted: true } };
  }

  async detectar(sentenciaId: number, usuarioId?: number) {
    const sentencia = await this.prisma.sentencia.findUnique({
      where: { id: sentenciaId },
      include: {
        sumarios: { where: { activo: true }, orderBy: { id: 'asc' } },
        archivosPdf: { orderBy: { createdAt: 'desc' } },
        referenciasNormativas: true,
      },
    });

    if (!sentencia) {
      throw new NotFoundException('Sentencia no encontrada');
    }

    const textoBase = [
      sentencia.resena,
      sentencia.resumenIa,
      sentencia.objeto,
      ...sentencia.sumarios.map((sumario) =>
        [sumario.tema, sumario.texto].join('\n'),
      ),
    ]
      .filter(Boolean)
      .join('\n\n');

    const archivo = sentencia.archivosPdf.find((item) =>
      archivoPdfEsReal(item),
    );
    const textoPdf = archivo
      ? await this.pdfService.extraerTexto(archivo.rutaArchivo)
      : '';

    const detectadas = this.normasDetectorService.detectar(
      [textoBase, textoPdf].join('\n\n'),
    );
    let creadas = 0;
    let duplicadas = 0;
    const creadasItems: unknown[] = [];

    for (const item of detectadas) {
      const exists = await this.prisma.referenciaNormativa.findFirst({
        where: {
          sentenciaId,
          tipoNorma: item.tipoNorma,
          numeroNorma: item.numeroNorma ?? null,
          articulo: item.articulo ?? null,
          inciso: item.inciso ?? null,
        },
      });

      if (exists) {
        duplicadas += 1;
        continue;
      }

      const creada = await this.prisma.referenciaNormativa.create({
        data: {
          sentenciaId,
          tipoNorma: item.tipoNorma,
          numeroNorma: item.numeroNorma,
          articulo: item.articulo,
          inciso: item.inciso,
          textoReferencia: item.textoReferencia,
        },
      });
      creadas += 1;
      creadasItems.push(creada);
    }

    if (usuarioId && creadas > 0) {
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'REFERENCIA',
        entidadId: sentenciaId,
        accion: 'CREATE',
        descripcion: `Detectó ${creadas} referencia(s) normativa(s) automáticamente`,
        datosDespues: creadasItems,
      });
    }

    return {
      data: {
        detectadas,
        creadas,
        duplicadas,
      },
    };
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

  private async ensureExists(id: number) {
    const referencia = await this.prisma.referenciaNormativa.findUnique({
      where: { id },
    });
    if (!referencia) {
      throw new NotFoundException('Referencia normativa no encontrada');
    }
    return referencia;
  }
}

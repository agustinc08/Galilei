import { Injectable, NotFoundException } from '@nestjs/common';
import { LogsService } from '../logs/logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReferenciaJurisprudencialDto } from './dto/create-referencia-jurisprudencial.dto';
import { UpdateReferenciaJurisprudencialDto } from './dto/update-referencia-jurisprudencial.dto';

@Injectable()
export class ReferenciasJurisprudencialesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logsService: LogsService,
  ) {}

  async findBySentencia(sentenciaId: number) {
    await this.ensureSentenciaExists(sentenciaId);
    const data = await this.prisma.referenciaJurisprudencial.findMany({
      where: { sentenciaId },
      include: {
        falloRelacionado: {
          select: {
            id: true,
            numeroSentencia: true,
            expediente: true,
            sala: true,
            fecha: true,
            slugPublico: true,
          },
        },
      },
      orderBy: { id: 'desc' },
    });
    return { data };
  }

  async create(
    sentenciaId: number,
    dto: CreateReferenciaJurisprudencialDto,
    usuarioId?: number,
  ) {
    await this.ensureSentenciaExists(sentenciaId);
    const data = await this.prisma.referenciaJurisprudencial.create({
      data: { sentenciaId, ...dto },
      include: {
        falloRelacionado: {
          select: {
            id: true,
            numeroSentencia: true,
            expediente: true,
            sala: true,
            fecha: true,
            slugPublico: true,
          },
        },
      },
    });
    if (usuarioId) {
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'REFERENCIA',
        entidadId: data.id,
        accion: 'CREATE',
        descripcion: 'Creó referencia jurisprudencial',
        datosDespues: data,
      });
    }
    return { data };
  }

  async update(
    id: number,
    dto: UpdateReferenciaJurisprudencialDto,
    usuarioId?: number,
  ) {
    const before = await this.ensureExists(id);
    const data = await this.prisma.referenciaJurisprudencial.update({
      where: { id },
      data: dto,
      include: {
        falloRelacionado: {
          select: {
            id: true,
            numeroSentencia: true,
            expediente: true,
            sala: true,
            fecha: true,
            slugPublico: true,
          },
        },
      },
    });
    if (usuarioId) {
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'REFERENCIA',
        entidadId: id,
        accion: 'UPDATE',
        descripcion: 'Editó referencia jurisprudencial',
        datosAntes: before,
        datosDespues: data,
      });
    }
    return { data };
  }

  async remove(id: number, usuarioId?: number) {
    const before = await this.ensureExists(id);
    await this.prisma.referenciaJurisprudencial.delete({ where: { id } });
    if (usuarioId) {
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'REFERENCIA',
        entidadId: id,
        accion: 'DELETE',
        descripcion: 'Eliminó referencia jurisprudencial',
        datosAntes: before,
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

  private async ensureExists(id: number) {
    const referencia = await this.prisma.referenciaJurisprudencial.findUnique({
      where: { id },
    });
    if (!referencia) {
      throw new NotFoundException('Referencia jurisprudencial no encontrada');
    }
    return referencia;
  }
}

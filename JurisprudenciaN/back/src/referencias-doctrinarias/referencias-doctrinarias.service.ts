import { Injectable, NotFoundException } from '@nestjs/common';
import { LogsService } from '../logs/logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReferenciaDoctrinariaDto } from './dto/create-referencia-doctrinaria.dto';
import { UpdateReferenciaDoctrinariaDto } from './dto/update-referencia-doctrinaria.dto';

@Injectable()
export class ReferenciasDoctrinariasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logsService: LogsService,
  ) {}

  private get client() {
    return this.prisma as unknown as {
      referenciaDoctrinaria: any;
      sentencia: any;
    };
  }

  async findBySentencia(sentenciaId: number) {
    await this.ensureSentenciaExists(sentenciaId);
    const data = await this.client.referenciaDoctrinaria.findMany({
      where: { sentenciaId },
      orderBy: [{ anio: 'desc' }, { id: 'desc' }],
    });
    return { data };
  }

  async create(sentenciaId: number, dto: CreateReferenciaDoctrinariaDto, usuarioId?: number) {
    await this.ensureSentenciaExists(sentenciaId);
    const data = await this.client.referenciaDoctrinaria.create({
      data: { sentenciaId, ...dto },
    });
    if (usuarioId) {
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'REFERENCIA',
        entidadId: data.id,
        accion: 'CREATE',
        descripcion: 'Creó referencia doctrinaria',
        datosDespues: data,
      });
    }
    return { data };
  }

  async update(id: number, dto: UpdateReferenciaDoctrinariaDto, usuarioId?: number) {
    const before = await this.ensureExists(id);
    const data = await this.client.referenciaDoctrinaria.update({
      where: { id },
      data: dto,
    });
    if (usuarioId) {
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'REFERENCIA',
        entidadId: id,
        accion: 'UPDATE',
        descripcion: 'Editó referencia doctrinaria',
        datosAntes: before,
        datosDespues: data,
      });
    }
    return { data };
  }

  async remove(id: number, usuarioId?: number) {
    const before = await this.ensureExists(id);
    await this.client.referenciaDoctrinaria.delete({ where: { id } });
    if (usuarioId) {
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'REFERENCIA',
        entidadId: id,
        accion: 'DELETE',
        descripcion: 'Eliminó referencia doctrinaria',
        datosAntes: before,
      });
    }
    return { data: { deleted: true } };
  }

  private async ensureSentenciaExists(sentenciaId: number) {
    const sentencia = await this.client.sentencia.findUnique({
      where: { id: sentenciaId },
      select: { id: true },
    });
    if (!sentencia) {
      throw new NotFoundException('Sentencia no encontrada');
    }
  }

  private async ensureExists(id: number) {
    const referencia = await this.client.referenciaDoctrinaria.findUnique({
      where: { id },
    });
    if (!referencia) {
      throw new NotFoundException('Referencia doctrinaria no encontrada');
    }
    return referencia;
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import {
  buildSumarioSearchData,
  normalizeSearchText,
} from '../busqueda/utils/search-normalizer';
import { LogsService } from '../logs/logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSumarioDto } from './dto/create-sumario.dto';
import { QuerySumariosDto } from './dto/query-sumarios.dto';
import { UpdateSumarioDto } from './dto/update-sumario.dto';

const sentenciaResumenSelect = {
  id: true,
  numeroSentencia: true,
  sala: true,
  fecha: true,
  expediente: true,
  actor: true,
  demandado: true,
} satisfies Prisma.SentenciaSelect;

@Injectable()
export class SumariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logsService: LogsService,
  ) {}

  async findAll(query: QuerySumariosDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const where = this.buildWhere(query);

    const [data, total] = await this.prisma.$transaction([
      this.prisma.sumario.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { id: 'desc' },
        include: { sentencia: { select: sentenciaResumenSelect } },
      }),
      this.prisma.sumario.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        pageSize,
        total,
        pageCount: Math.ceil(total / pageSize),
      },
    };
  }

  async buscar(query?: string) {
    if (!query?.trim()) {
      throw new BadRequestException('El parametro query es requerido');
    }

    const search = query.trim();
    const normalizedSearch = normalizeSearchText(search);

    const data = await this.prisma.sumario.findMany({
      where: {
        OR: [
          { textoBusquedaNormalizado: { contains: normalizedSearch } },
          { tema: { contains: search, mode: 'insensitive' } },
          { texto: { contains: search, mode: 'insensitive' } },
          { resumenBusqueda: { contains: search, mode: 'insensitive' } },
        ],
      },
      include: { sentencia: { select: sentenciaResumenSelect } },
      orderBy: { id: 'desc' },
      take: 50,
    });

    return { data };
  }

  async findOne(id: number) {
    const sumario = await this.prisma.sumario.findUnique({
      where: { id },
      include: { sentencia: { select: sentenciaResumenSelect } },
    });

    if (!sumario) {
      throw new NotFoundException('Sumario no encontrado');
    }

    return { data: sumario };
  }

  async create(createSumarioDto: CreateSumarioDto, usuarioId?: number) {
    try {
      const sumario = await this.prisma.sumario.create({
        data: {
          ...createSumarioDto,
          ...buildSumarioSearchData(createSumarioDto),
        },
        include: { sentencia: { select: sentenciaResumenSelect } },
      });

      if (usuarioId) {
        await this.logsService.registrarAccion({
          usuarioId,
          entidad: 'SUMARIO',
          entidadId: sumario.id,
          accion: 'CREATE',
          descripcion: 'Creó sumario',
          datosDespues: sumario,
        });
      }

      return { data: sumario };
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async update(
    id: number,
    updateSumarioDto: UpdateSumarioDto,
    usuarioId?: number,
  ) {
    await this.ensureExists(id);

    const existing = await this.prisma.sumario.findUniqueOrThrow({
      where: { id },
    });
    const data = {
      ...updateSumarioDto,
      ...buildSumarioSearchData({
        ...existing,
        ...updateSumarioDto,
      }),
    };

    try {
      const sumario = await this.prisma.sumario.update({
        where: { id },
        data,
        include: { sentencia: { select: sentenciaResumenSelect } },
      });

      if (usuarioId) {
        await this.logsService.registrarAccion({
          usuarioId,
          entidad: 'SUMARIO',
          entidadId: id,
          accion: 'UPDATE',
          descripcion: 'Editó sumario',
          datosAntes: existing,
          datosDespues: sumario,
        });
      }

      return { data: sumario };
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async setPublicado(id: number, publicado: boolean, usuarioId?: number) {
    await this.ensureExists(id);
    const before = await this.prisma.sumario.findUniqueOrThrow({
      where: { id },
    });

    const sumario = await this.prisma.sumario.update({
      where: { id },
      data: { publicado },
      include: { sentencia: { select: sentenciaResumenSelect } },
    });

    if (usuarioId) {
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'SUMARIO',
        entidadId: id,
        accion: publicado ? 'PUBLICAR' : 'DESPUBLICAR',
        descripcion: publicado ? 'Publicó sumario' : 'Despublicó sumario',
        datosAntes: before,
        datosDespues: sumario,
      });
    }

    return { data: sumario };
  }

  async remove(id: number, usuarioId?: number) {
    await this.ensureExists(id);
    const before = await this.prisma.sumario.findUniqueOrThrow({
      where: { id },
    });

    const sumario = await this.prisma.sumario.update({
      where: { id },
      data: { activo: false },
      include: { sentencia: { select: sentenciaResumenSelect } },
    });

    if (usuarioId) {
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'SUMARIO',
        entidadId: id,
        accion: 'DELETE',
        descripcion: 'Eliminó lógicamente sumario',
        datosAntes: before,
        datosDespues: sumario,
      });
    }

    return { data: sumario };
  }

  private buildWhere(query: QuerySumariosDto): Prisma.SumarioWhereInput {
    return {
      ...(query.sentenciaId && { sentenciaId: query.sentenciaId }),
      ...(query.publicado !== undefined && { publicado: query.publicado }),
      ...(query.activo !== undefined && { activo: query.activo }),
      ...(query.tema && {
        tema: { contains: query.tema, mode: 'insensitive' },
      }),
      ...(query.numeroSumario && {
        numeroSumario: { contains: query.numeroSumario, mode: 'insensitive' },
      }),
    };
  }

  private async ensureExists(id: number) {
    const sumario = await this.prisma.sumario.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!sumario) {
      throw new NotFoundException('Sumario no encontrado');
    }
  }

  private handlePrismaError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2003'
    ) {
      throw new ConflictException('La sentencia indicada no existe');
    }

    throw error;
  }
}

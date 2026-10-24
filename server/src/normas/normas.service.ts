import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEquivalenciaNormativaDto } from './dto/create-equivalencia-normativa.dto';
import { CreateNormaArticuloDto } from './dto/create-norma-articulo.dto';
import { QueryNormasDto } from './dto/query-normas.dto';
import { UpdateNormaArticuloDto } from './dto/update-norma-articulo.dto';

@Injectable()
export class NormasService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryNormasDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.NormaArticuloWhereInput = {
      ...(query.codigo && {
        codigo: { contains: query.codigo, mode: 'insensitive' },
      }),
      ...(query.articulo && {
        articulo: { contains: query.articulo, mode: 'insensitive' },
      }),
      ...(query.numeroNorma && {
        numeroNorma: { contains: query.numeroNorma, mode: 'insensitive' },
      }),
      ...(query.vigente !== undefined && { vigente: query.vigente }),
      ...(query.q && {
        OR: [
          { codigo: { contains: query.q, mode: 'insensitive' } },
          { articulo: { contains: query.q, mode: 'insensitive' } },
          { numeroNorma: { contains: query.q, mode: 'insensitive' } },
          { titulo: { contains: query.q, mode: 'insensitive' } },
          { texto: { contains: query.q, mode: 'insensitive' } },
        ],
      }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.normaArticulo.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [
          { codigo: 'asc' },
          { numeroNorma: 'asc' },
          { articulo: 'asc' },
        ],
      }),
      this.prisma.normaArticulo.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        pageSize,
        pageCount: Math.ceil(total / pageSize),
      },
    };
  }

  async findOne(id: number) {
    const data = await this.prisma.normaArticulo.findUnique({
      where: { id },
      include: {
        equivalenciasOrigen: {
          include: { articuloDestino: true },
          orderBy: { createdAt: 'desc' },
        },
        equivalenciasDestino: {
          include: { articuloOrigen: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!data) {
      throw new NotFoundException('Norma no encontrada');
    }

    return { data };
  }

  async create(dto: CreateNormaArticuloDto) {
    const data = await this.prisma.normaArticulo.create({ data: dto });
    return { data };
  }

  async update(id: number, dto: UpdateNormaArticuloDto) {
    await this.ensureNormaExists(id);
    const data = await this.prisma.normaArticulo.update({
      where: { id },
      data: dto,
    });
    return { data };
  }

  async remove(id: number) {
    await this.ensureNormaExists(id);
    const data = await this.prisma.normaArticulo.update({
      where: { id },
      data: { vigente: false },
    });
    return { data };
  }

  async findEquivalencias(id: number) {
    await this.ensureNormaExists(id);
    const data = await this.prisma.equivalenciaNormativa.findMany({
      where: {
        OR: [{ articuloOrigenId: id }, { articuloDestinoId: id }],
      },
      include: {
        articuloOrigen: true,
        articuloDestino: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return { data };
  }

  async createEquivalencia(id: number, dto: CreateEquivalenciaNormativaDto) {
    await this.ensureNormaExists(id);
    await this.ensureNormaExists(dto.articuloDestinoId);

    const exists = await this.prisma.equivalenciaNormativa.findFirst({
      where: {
        articuloOrigenId: id,
        articuloDestinoId: dto.articuloDestinoId,
        tipoRelacion: { equals: dto.tipoRelacion, mode: 'insensitive' },
      },
      select: { id: true },
    });

    if (exists) {
      throw new BadRequestException('La equivalencia normativa ya existe');
    }

    const data = await this.prisma.equivalenciaNormativa.create({
      data: {
        articuloOrigenId: id,
        articuloDestinoId: dto.articuloDestinoId,
        tipoRelacion: dto.tipoRelacion,
        observacion: dto.observacion,
      },
      include: {
        articuloOrigen: true,
        articuloDestino: true,
      },
    });

    return { data };
  }

  async removeEquivalencia(id: number) {
    const equivalencia = await this.prisma.equivalenciaNormativa.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!equivalencia) {
      throw new NotFoundException('Equivalencia normativa no encontrada');
    }

    await this.prisma.equivalenciaNormativa.delete({ where: { id } });
    return { data: { deleted: true } };
  }

  private async ensureNormaExists(id: number) {
    const norma = await this.prisma.normaArticulo.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!norma) {
      throw new NotFoundException('Norma no encontrada');
    }
  }
}

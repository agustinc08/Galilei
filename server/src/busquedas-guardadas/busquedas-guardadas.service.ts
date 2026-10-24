import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBusquedaGuardadaDto } from './dto/create-busqueda-guardada.dto';
import { UpdateBusquedaGuardadaDto } from './dto/update-busqueda-guardada.dto';

@Injectable()
export class BusquedasGuardadasService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(usuarioId: number) {
    const data = await this.prisma.busquedaGuardada.findMany({
      where: { usuarioId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });

    return { data };
  }

  async findOne(usuarioId: number, id: number) {
    const busqueda = await this.prisma.busquedaGuardada.findFirst({
      where: { id, usuarioId },
    });

    if (!busqueda) {
      throw new NotFoundException('Busqueda guardada no encontrada');
    }

    return { data: busqueda };
  }

  async create(usuarioId: number, dto: CreateBusquedaGuardadaDto) {
    const data = await this.prisma.busquedaGuardada.create({
      data: {
        usuarioId,
        nombre: dto.nombre,
        queryJson: dto.queryJson as Prisma.InputJsonValue,
      },
    });

    return { data };
  }

  async update(usuarioId: number, id: number, dto: UpdateBusquedaGuardadaDto) {
    await this.findOne(usuarioId, id);

    const data = await this.prisma.busquedaGuardada.update({
      where: { id },
      data: {
        ...(dto.nombre !== undefined && { nombre: dto.nombre }),
        ...(dto.queryJson !== undefined && {
          queryJson: dto.queryJson as Prisma.InputJsonValue,
        }),
      },
    });

    return { data };
  }

  async remove(usuarioId: number, id: number) {
    await this.findOne(usuarioId, id);

    await this.prisma.busquedaGuardada.delete({
      where: { id },
    });

    return { data: { deleted: true } };
  }
}

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCatalogoItemDto } from './dto/create-catalogo-item.dto';
import { UpdateCatalogoItemDto } from './dto/update-catalogo-item.dto';

type CatalogKind = 'salas' | 'tipos-fallo' | 'tribunales-origen';

@Injectable()
export class CatalogosService {
  constructor(private readonly prisma: PrismaService) {}

  async getSalas(includeInactive = false) {
    return {
      data: await this.prisma.sala.findMany({
        where: includeInactive ? undefined : { activa: true },
        orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
      }),
    };
  }

  async getTiposFallo(includeInactive = false) {
    return {
      data: await this.prisma.tipoFallo.findMany({
        where: includeInactive ? undefined : { activo: true },
        orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
      }),
    };
  }

  async getTribunalesOrigen(includeInactive = false) {
    return {
      data: await this.prisma.tribunalOrigen.findMany({
        where: includeInactive ? undefined : { activo: true },
        orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
      }),
    };
  }

  async createSala(dto: CreateCatalogoItemDto) {
    return { data: await this.createItem('salas', dto) };
  }

  async updateSala(id: number, dto: UpdateCatalogoItemDto) {
    return { data: await this.updateItem('salas', id, dto) };
  }

  async createTipoFallo(dto: CreateCatalogoItemDto) {
    return { data: await this.createItem('tipos-fallo', dto) };
  }

  async updateTipoFallo(id: number, dto: UpdateCatalogoItemDto) {
    return { data: await this.updateItem('tipos-fallo', id, dto) };
  }

  async createTribunalOrigen(dto: CreateCatalogoItemDto) {
    return { data: await this.createItem('tribunales-origen', dto) };
  }

  async updateTribunalOrigen(id: number, dto: UpdateCatalogoItemDto) {
    return { data: await this.updateItem('tribunales-origen', id, dto) };
  }

  async getCatalogValueIds(input: {
    salaId?: number | null;
    tipoFalloId?: number | null;
    tribunalOrigenId?: number | null;
  }) {
    const [sala, tipoFallo, tribunalOrigen] = await Promise.all([
      input.salaId
        ? this.prisma.sala.findUnique({ where: { id: input.salaId } })
        : Promise.resolve(null),
      input.tipoFalloId
        ? this.prisma.tipoFallo.findUnique({ where: { id: input.tipoFalloId } })
        : Promise.resolve(null),
      input.tribunalOrigenId
        ? this.prisma.tribunalOrigen.findUnique({
            where: { id: input.tribunalOrigenId },
          })
        : Promise.resolve(null),
    ]);

    if (input.salaId && !sala) {
      throw new NotFoundException('Sala de catalogo no encontrada');
    }
    if (input.tipoFalloId && !tipoFallo) {
      throw new NotFoundException('Tipo de fallo de catalogo no encontrado');
    }
    if (input.tribunalOrigenId && !tribunalOrigen) {
      throw new NotFoundException(
        'Tribunal de origen de catalogo no encontrado',
      );
    }

    return { sala, tipoFallo, tribunalOrigen };
  }

  private async createItem(kind: CatalogKind, dto: CreateCatalogoItemDto) {
    try {
      if (kind === 'salas') {
        return await this.prisma.sala.create({
          data: {
            nombre: dto.nombre.trim(),
            codigo: dto.codigo?.trim() || null,
            orden: dto.orden,
            activa: dto.activo ?? true,
          },
        });
      }

      if (kind === 'tipos-fallo') {
        return await this.prisma.tipoFallo.create({
          data: {
            nombre: dto.nombre.trim(),
            codigo: dto.codigo?.trim() || null,
            orden: dto.orden,
            activo: dto.activo ?? true,
          },
        });
      }

      return await this.prisma.tribunalOrigen.create({
        data: {
          nombre: dto.nombre.trim(),
          codigo: dto.codigo?.trim() || null,
          orden: dto.orden,
          activo: dto.activo ?? true,
        },
      });
    } catch (error) {
      this.handleUniqueError(error);
    }
  }

  private async updateItem(
    kind: CatalogKind,
    id: number,
    dto: UpdateCatalogoItemDto,
  ) {
    try {
      if (kind === 'salas') {
        return await this.prisma.sala.update({
          where: { id },
          data: {
            ...(dto.nombre !== undefined && { nombre: dto.nombre.trim() }),
            ...(dto.codigo !== undefined && {
              codigo: dto.codigo.trim() || null,
            }),
            ...(dto.orden !== undefined && { orden: dto.orden }),
            ...(dto.activo !== undefined && { activa: dto.activo }),
          },
        });
      }

      if (kind === 'tipos-fallo') {
        return await this.prisma.tipoFallo.update({
          where: { id },
          data: {
            ...(dto.nombre !== undefined && { nombre: dto.nombre.trim() }),
            ...(dto.codigo !== undefined && {
              codigo: dto.codigo.trim() || null,
            }),
            ...(dto.orden !== undefined && { orden: dto.orden }),
            ...(dto.activo !== undefined && { activo: dto.activo }),
          },
        });
      }

      return await this.prisma.tribunalOrigen.update({
        where: { id },
        data: {
          ...(dto.nombre !== undefined && { nombre: dto.nombre.trim() }),
          ...(dto.codigo !== undefined && {
            codigo: dto.codigo.trim() || null,
          }),
          ...(dto.orden !== undefined && { orden: dto.orden }),
          ...(dto.activo !== undefined && { activo: dto.activo }),
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Registro de catalogo no encontrado');
      }
      this.handleUniqueError(error);
    }
  }

  private handleUniqueError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'Ya existe un registro de catalogo con ese nombre o codigo',
      );
    }
    throw error;
  }
}

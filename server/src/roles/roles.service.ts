import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRolDto } from './dto/create-rol.dto';
import { UpdateRolDto } from './dto/update-rol.dto';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const roles = await this.prisma.rol.findMany({
      orderBy: { nombre: 'asc' },
    });

    return { data: roles };
  }

  async findOne(id: number) {
    const rol = await this.prisma.rol.findUnique({ where: { id } });

    if (!rol) {
      throw new NotFoundException('Rol no encontrado');
    }

    return { data: rol };
  }

  async create(createRolDto: CreateRolDto) {
    try {
      const rol = await this.prisma.rol.create({ data: createRolDto });
      return { data: rol };
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async update(id: number, updateRolDto: UpdateRolDto) {
    await this.findOne(id);

    try {
      const rol = await this.prisma.rol.update({
        where: { id },
        data: updateRolDto,
      });
      return { data: rol };
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async remove(id: number) {
    await this.findOne(id);

    try {
      await this.prisma.rol.delete({ where: { id } });
      return { data: { deleted: true } };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new ConflictException(
          'No se puede eliminar el rol porque tiene usuarios asociados',
        );
      }

      throw error;
    }
  }

  private handlePrismaError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Ya existe un rol con ese nombre');
    }

    throw error;
  }
}

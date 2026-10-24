import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';

const usuarioSelect = {
  id: true,
  nombre: true,
  apellido: true,
  email: true,
  activo: true,
  rolId: true,
  createdAt: true,
  updatedAt: true,
  rol: true,
} satisfies Prisma.UsuarioSelect;

@Injectable()
export class UsuariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  async findAll() {
    const usuarios = await this.prisma.usuario.findMany({
      select: usuarioSelect,
      orderBy: { id: 'asc' },
    });

    return { data: usuarios };
  }

  async findOne(id: number) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id },
      select: usuarioSelect,
    });

    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado');
    }

    return { data: usuario };
  }

  async create(createUsuarioDto: CreateUsuarioDto) {
    const { password, ...data } = createUsuarioDto;
    const passwordHash = await this.authService.hashContraseña(password);

    try {
      const usuario = await this.prisma.usuario.create({
        data: { ...data, passwordHash },
        select: usuarioSelect,
      });
      return { data: usuario };
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async update(id: number, updateUsuarioDto: UpdateUsuarioDto) {
    await this.findOne(id);

    const { password, ...data } = updateUsuarioDto;
    const updateData: Prisma.UsuarioUpdateInput = { ...data };

    if (password) {
      updateData.passwordHash = await this.authService.hashContraseña(password);
    }

    try {
      const usuario = await this.prisma.usuario.update({
        where: { id },
        data: updateData,
        select: usuarioSelect,
      });
      return { data: usuario };
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async remove(id: number) {
    await this.findOne(id);

    const usuario = await this.prisma.usuario.update({
      where: { id },
      data: { activo: false },
      select: usuarioSelect,
    });

    return { data: usuario };
  }

  async resetPassword(id: number, dto: ResetPasswordDto) {
    await this.findOne(id);

    const usuario = await this.prisma.usuario.update({
      where: { id },
      data: {
        passwordHash: await this.authService.hashContraseña(dto.newPassword),
      },
      select: usuarioSelect,
    });

    return { data: usuario };
  }

  private handlePrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ConflictException('Ya existe un usuario con ese email');
      }

      if (error.code === 'P2003') {
        throw new ConflictException('El rol indicado no existe');
      }
    }

    throw error;
  }
}

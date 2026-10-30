import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { AuthService } from '../auth/auth.service';
import { LogsService } from '../logs/logs.service';
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
  workspaceMemberships: {
    select: {
      role: true,
      active: true,
      workspace: {
        select: {
          id: true,
          active: true,
          dependency: {
            select: {
              id: true,
              code: true,
              name: true,
              type: true,
              active: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.UsuarioSelect;

type UsuarioAuditSnapshot = {
  id: number;
  nombre: string;
  apellido: string | null;
  email: string;
  activo: boolean;
  rolId: number;
  rol: { nombre: string };
};

function auditSnapshot(usuario: UsuarioAuditSnapshot) {
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    apellido: usuario.apellido,
    email: usuario.email,
    activo: usuario.activo,
    rolId: usuario.rolId,
    rol: usuario.rol.nombre,
  };
}

@Injectable()
export class UsuariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly logsService: LogsService,
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

  async create(createUsuarioDto: CreateUsuarioDto, actorId: number) {
    const { password, ...data } = createUsuarioDto;
    const passwordHash = await this.authService.hashContraseña(password);

    try {
      const usuario = await this.prisma.usuario.create({
        data: { ...data, passwordHash },
        select: usuarioSelect,
      });
      await this.logsService.registrarAccion({
        usuarioId: actorId,
        entidad: 'Usuario',
        entidadId: usuario.id,
        accion: 'USER_CREATE',
        descripcion: 'Usuario creado por administración.',
        datosDespues: auditSnapshot(usuario),
      });
      return { data: usuario };
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async update(
    id: number,
    updateUsuarioDto: UpdateUsuarioDto,
    actorId: number,
  ) {
    const before = (await this.findOne(id)).data;

    const { password, ...data } = updateUsuarioDto;
    if (id === actorId && data.activo === false) {
      throw new BadRequestException('No podés desactivar tu propia cuenta.');
    }
    await this.protectLastAdmin(before, data);
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
      const beforeSnapshot = auditSnapshot(before);
      const afterSnapshot = auditSnapshot(usuario);
      if (before.activo !== usuario.activo) {
        await this.logsService.registrarAccion({
          usuarioId: actorId,
          entidad: 'Usuario',
          entidadId: usuario.id,
          accion: usuario.activo ? 'USER_ACTIVATE' : 'USER_DEACTIVATE',
          descripcion: usuario.activo
            ? 'Usuario reactivado por administración.'
            : 'Usuario desactivado por administración.',
          datosAntes: beforeSnapshot,
          datosDespues: afterSnapshot,
        });
      }
      if (before.rolId !== usuario.rolId) {
        await this.logsService.registrarAccion({
          usuarioId: actorId,
          entidad: 'Usuario',
          entidadId: usuario.id,
          accion: 'USER_ROLE_CHANGE',
          descripcion: 'Rol global actualizado por administración.',
          datosAntes: beforeSnapshot,
          datosDespues: afterSnapshot,
        });
      }
      if (
        before.nombre !== usuario.nombre ||
        before.apellido !== usuario.apellido ||
        before.email !== usuario.email
      ) {
        await this.logsService.registrarAccion({
          usuarioId: actorId,
          entidad: 'Usuario',
          entidadId: usuario.id,
          accion: 'USER_UPDATE',
          descripcion: 'Datos de identidad actualizados por administración.',
          datosAntes: beforeSnapshot,
          datosDespues: afterSnapshot,
        });
      }
      if (password) {
        await this.logsService.registrarAccion({
          usuarioId: actorId,
          entidad: 'Usuario',
          entidadId: usuario.id,
          accion: 'USER_PASSWORD_RESET',
          descripcion: 'Contraseña restablecida por administración.',
        });
      }
      return { data: usuario };
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async remove(id: number, actorId: number) {
    return this.update(id, { activo: false }, actorId);
  }

  async resetPassword(id: number, dto: ResetPasswordDto, actorId: number) {
    const usuario = (await this.findOne(id)).data;

    await this.prisma.usuario.update({
      where: { id },
      data: {
        passwordHash: await this.authService.hashContraseña(dto.newPassword),
      },
    });

    await this.logsService.registrarAccion({
      usuarioId: actorId,
      entidad: 'Usuario',
      entidadId: id,
      accion: 'USER_PASSWORD_RESET',
      descripcion: 'Contraseña restablecida por administración.',
      datosAntes: auditSnapshot(usuario),
      datosDespues: auditSnapshot(usuario),
    });

    return { data: usuario };
  }

  async findAudit(id: number) {
    await this.findOne(id);
    const data = await this.prisma.accionLog.findMany({
      where: { entidad: 'Usuario', entidadId: id },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: {
        id: true,
        usuarioId: true,
        entidad: true,
        entidadId: true,
        accion: true,
        descripcion: true,
        datosAntes: true,
        datosDespues: true,
        createdAt: true,
        usuario: {
          select: { id: true, nombre: true, apellido: true, email: true },
        },
      },
    });
    return { data };
  }

  private async protectLastAdmin(
    before: Pick<UsuarioAuditSnapshot, 'activo' | 'rolId' | 'rol'>,
    update: Pick<UpdateUsuarioDto, 'activo' | 'rolId'>,
  ) {
    const removesAdmin =
      before.activo &&
      before.rol.nombre === 'ADMIN' &&
      (update.activo === false ||
        (update.rolId !== undefined && update.rolId !== before.rolId));
    if (!removesAdmin) return;

    const activeAdminCount = await this.prisma.usuario.count({
      where: { activo: true, rol: { nombre: 'ADMIN' } },
    });
    if (activeAdminCount <= 1) {
      throw new BadRequestException(
        'El sistema debe conservar al menos un administrador activo.',
      );
    }
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

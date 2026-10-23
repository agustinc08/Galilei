import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { AuthenticatedUser } from './types/authenticated-user.type';
import { JwtPayload } from './types/jwt-payload.type';

@Injectable()
export class AuthService {
  private readonly saltRounds = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  hashContraseña(password: string): Promise<string> {
    return bcrypt.hash(password, this.saltRounds);
  }

  compareContraseña(password: string, passwordHash: string): Promise<boolean> {
    return bcrypt.compare(password, passwordHash);
  }

  async login(loginDto: LoginDto) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: loginDto.email },
      include: { rol: true },
    });

    if (!usuario) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (!usuario.activo) {
      throw new UnauthorizedException('Usuario inactivo');
    }

    const passwordValida = await this.compareContraseña(
      loginDto.password,
      usuario.passwordHash,
    );

    if (!passwordValida) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const payload: JwtPayload = {
      sub: usuario.id,
      email: usuario.email,
      rol: usuario.rol.nombre as JwtPayload['rol'],
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      user: {
        id: usuario.id,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        email: usuario.email,
        activo: usuario.activo,
        rol: {
          id: usuario.rol.id,
          nombre: usuario.rol.nombre,
        },
      },
    };
  }

  me(user: AuthenticatedUser) {
    return user;
  }

  async changePassword(usuarioId: number, dto: ChangePasswordDto) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { id: true, passwordHash: true, activo: true },
    });

    if (!usuario || !usuario.activo) {
      throw new UnauthorizedException('Usuario no válido');
    }

    const currentPasswordValida = await this.compareContraseña(
      dto.currentPassword,
      usuario.passwordHash,
    );

    if (!currentPasswordValida) {
      throw new UnauthorizedException('Contraseña actual inválida');
    }

    await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: { passwordHash: await this.hashContraseña(dto.newPassword) },
    });

    return { data: { message: 'Contraseña actualizada correctamente' } };
  }
}

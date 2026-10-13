// usuario.service.ts

import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaClient, User } from '@prisma/client';

@Injectable()
export class UsuarioService {
  constructor(private prisma: PrismaClient) { }

  async hashPassword(password: string): Promise<string> {
    const saltRounds = 10;
    return bcrypt.hash(password, saltRounds);
  }

  async createUser(email: string, password: string, role: string, username: string): Promise<User> {
    try {
      const hashedPassword = await this.hashPassword(password);
      bcrypt
      const result = await this.prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          role,
          username
        },
      });

      return result;
    } catch (error) {
      throw new InternalServerErrorException('Error al crear usuario: ' + error);
    }
  }

  async comparePasswords(plainTextPassword: string, hashedPassword: string): Promise<boolean> {
    return bcrypt.compare(plainTextPassword, hashedPassword);
  }
  async getUserByEmail(email: string): Promise<User | null> {
    try {
      const result = await this.prisma.user.findUnique({
        where: {
          email: email,
        },
      });
      return result;
    } catch (error) {
      throw new InternalServerErrorException('Error al obtener usuario por email: ' + error);
    }
  }


}

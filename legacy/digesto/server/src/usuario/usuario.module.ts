// usuario.module.ts
import { Module } from '@nestjs/common';
import { UsuarioController } from './usuario.controller';
import { UsuarioService } from './usuario.service';
import { PrismaClient } from '@prisma/client';

@Module({
  controllers: [UsuarioController],
  providers: [
    UsuarioService,
    {
      provide: PrismaClient,
      useValue: new PrismaClient(),
    },
  ],
  exports: [UsuarioService],
})
export class UsuarioModule {}

// carga-de-datos.module.ts
import { Module } from '@nestjs/common';
import { CargaDeDatosController } from './carga-de-datos.controller';
import { CargaDeDatosService } from './carga-de-datos.service';
import { prisma } from './../../prisma/instance';  // Importa la instancia de Prisma desde el archivo creado
import { PrismaClient } from '@prisma/client';
@Module({
  controllers: [CargaDeDatosController],
  providers: [CargaDeDatosService, {
    provide: PrismaClient,
    useValue: prisma,  // Utiliza la instancia de Prisma importada
  }],
})
export class CargaDeDatosModule { }

import { Module } from '@nestjs/common';
import { TipoController } from './tipo.controller';
import { TipoService } from './tipo.service';
import { PrismaClient } from '@prisma/client';
@Module({
  controllers: [TipoController],
  providers: [TipoService, {
    provide: PrismaClient,
    useValue: new PrismaClient(),

  },
  ],
  exports :[TipoService]// Agregamos PrismaService como proveedor
})
export class TipoModule { }

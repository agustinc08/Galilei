// swagger.module.ts

import { Module } from '@nestjs/common';
import { SwaggerModule as NestSwaggerModule, DocumentBuilder } from '@nestjs/swagger';

@Module({})
export class SwaggerModule {
  static setup(path: string, app:any): void {
    const options = new DocumentBuilder()
      .setTitle('DIGESTO')
      .setDescription('API DIGESTO (Documentacion de endpoints)')
      .setVersion('100.0.1')
      .build();

    const document = NestSwaggerModule.createDocument(app, options);
    NestSwaggerModule.setup(path, app, document);
  }
}

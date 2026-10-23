// app.module.ts

import { Module } from '@nestjs/common';
import { CargaDeDatosModule } from './carga-de-datos/carga-de-datos.module';
import { UsuarioModule } from './usuario/usuario.module';
import { TipoModule } from './tipo/tipo.module';
import { SwaggerModule } from './swagger/swagger.module';
import { PdfModule } from './pdf/pdf.module';
import { DependenciaModule } from './dependencia/dependencia.module';

@Module({
  imports: [ CargaDeDatosModule, UsuarioModule, TipoModule, SwaggerModule, PdfModule, DependenciaModule],
})
export class AppModule {}

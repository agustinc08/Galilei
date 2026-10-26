import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ArchivosModule } from './archivos/archivos.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { BusquedaModule } from './busqueda/busqueda.module';
import { CorpusModule } from './corpus/corpus.module';
import { BusquedasGuardadasModule } from './busquedas-guardadas/busquedas-guardadas.module';
import { CatalogosModule } from './catalogos/catalogos.module';
import { CitasFalloModule } from './citas-fallo/citas-fallo.module';
import { EstadisticasModule } from './estadisticas/estadisticas.module';
import { FavoritosModule } from './favoritos/favoritos.module';
import { HealthController } from './health/health.controller';
import { InstitutosJuridicosModule } from './institutos-juridicos/institutos-juridicos.module';
import { LogsModule } from './logs/logs.module';
import { NormasModule } from './normas/normas.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReferenciasDoctrinariasModule } from './referencias-doctrinarias/referencias-doctrinarias.module';
import { ReferenciasJurisprudencialesModule } from './referencias-jurisprudenciales/referencias-jurisprudenciales.module';
import { ReferenciasNormativasModule } from './referencias-normativas/referencias-normativas.module';
import { ResearchCollectionsModule } from './research-collections/research-collections.module';
import { ResearchComparisonsModule } from './research-comparisons/research-comparisons.module';
import { ResearchRelationshipsModule } from './research-relationships/research-relationships.module';
import { RolesModule } from './roles/roles.module';
import { SentenciasModule } from './sentencias/sentencias.module';
import { SumariosModule } from './sumarios/sumarios.module';
import { UsuariosModule } from './usuarios/usuarios.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.development.local', '.env'],
    }),
    PrismaModule,
    AuthModule,
    RolesModule,
    UsuariosModule,
    SentenciasModule,
    SumariosModule,
    ArchivosModule,
    BusquedaModule,
    CorpusModule,
    FavoritosModule,
    BusquedasGuardadasModule,
    CatalogosModule,
    CitasFalloModule,
    EstadisticasModule,
    InstitutosJuridicosModule,
    LogsModule,
    NormasModule,
    ReferenciasNormativasModule,
    ReferenciasJurisprudencialesModule,
    ReferenciasDoctrinariasModule,
    ResearchCollectionsModule,
    ResearchComparisonsModule,
    ResearchRelationshipsModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}

import { RequestMethod, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { APP_GUARD } from '@nestjs/core';
import { AppModule } from '../app.module';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { IS_PUBLIC_KEY, ROLES_KEY } from './constants';
import { AuthController } from './auth.controller';
import { PublicArchivosController } from '../archivos/archivos.controller';
import { PublicBusquedaController } from '../busqueda/busqueda.controller';
import { CatalogosController } from '../catalogos/catalogos.controller';
import { PublicSentenciasController } from '../sentencias/public-sentencias.controller';
import { SentenciasController } from '../sentencias/sentencias.controller';
import { SumariosController } from '../sumarios/sumarios.controller';
import { PublicCorpusDocumentController } from '../corpus/corpus-document.controller';
import { OcrHumanReviewController } from '../corpus/ocr-human-review.controller';
import { HealthController } from '../health/health.controller';
import { IaController } from '../ia/ia.controller';
import {
  EstadisticasController,
  PublicEventosController,
} from '../estadisticas/estadisticas.controller';
import { PublicEvolutionController } from '../research-timelines/research-timelines.controller';
import { PublicResearchRelationshipsController } from '../research-relationships/research-relationships.controller';
import { ResearchComparisonsController } from '../research-comparisons/research-comparisons.controller';

const publicControllers = [
  AuthController,
  PublicArchivosController,
  PublicBusquedaController,
  CatalogosController,
  PublicSentenciasController,
  PublicCorpusDocumentController,
  HealthController,
  IaController,
  EstadisticasController,
  PublicEventosController,
  PublicEvolutionController,
  PublicResearchRelationshipsController,
  ResearchComparisonsController,
];

function publicEndpoints(controller: Type<unknown>) {
  const prefix = Reflect.getMetadata(PATH_METADATA, controller) as
    string | string[] | undefined;
  const basePath = Array.isArray(prefix) ? prefix[0] : (prefix ?? '');
  const prototype = controller.prototype as Record<string, unknown>;

  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor')
    .flatMap((name) => {
      const handler = prototype[name];
      if (typeof handler !== 'function') return [];
      const isPublic =
        Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true ||
        Reflect.getMetadata(IS_PUBLIC_KEY, controller) === true;
      if (!isPublic) return [];

      const method = Reflect.getMetadata(METHOD_METADATA, handler) as
        RequestMethod | undefined;
      if (method === undefined) return [];
      const routePath = Reflect.getMetadata(PATH_METADATA, handler) as
        string | string[] | undefined;
      const suffix = Array.isArray(routePath)
        ? routePath[0]
        : (routePath ?? '');
      const path = `/${[basePath, suffix].filter(Boolean).join('/')}`.replace(
        /\/{2,}/gu,
        '/',
      );
      return [{ method, path, handler: name }];
    });
}

describe('public API boundary', () => {
  const endpoints = publicControllers.flatMap(publicEndpoints);

  it('keeps anonymous non-GET endpoints on the explicit non-domain allowlist', () => {
    const methodNames = new Map<RequestMethod, string>([
      [RequestMethod.POST, 'POST'],
      [RequestMethod.PUT, 'PUT'],
      [RequestMethod.PATCH, 'PATCH'],
      [RequestMethod.DELETE, 'DELETE'],
    ]);
    const publicWrites = endpoints
      .filter((endpoint) => methodNames.has(endpoint.method))
      .map((endpoint) => `${methodNames.get(endpoint.method)} ${endpoint.path}`)
      .sort();

    expect(publicWrites).toEqual([
      'POST /auth/login',
      'POST /estadisticas/eventos/share-link',
      'POST /public/eventos',
      'POST /research/evolution/resolve',
    ]);
  });

  it('keeps internal jurisprudence, OCR, and editing controllers outside the public allowlist', () => {
    for (const controller of [
      SentenciasController,
      SumariosController,
      OcrHumanReviewController,
    ]) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, controller)).not.toBe(true);
      expect(Reflect.getMetadata(ROLES_KEY, controller)).toBeDefined();
      expect(publicEndpoints(controller)).toEqual([]);
    }
  });

  it('keeps JWT and role guards registered globally for routes outside the allowlist', () => {
    const providers = Reflect.getMetadata('providers', AppModule) as Array<{
      provide?: unknown;
      useClass?: unknown;
    }>;
    const globalGuards = providers
      .filter((provider) => provider.provide === APP_GUARD)
      .map((provider) => provider.useClass);

    expect(globalGuards).toEqual([JwtAuthGuard, RolesGuard]);
  });
});

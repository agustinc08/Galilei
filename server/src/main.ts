import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { SafeExceptionFilter } from './safe-exception.filter';
import { LocalApiRateLimiter } from './rate-limit.middleware';
import { createApplicationAfterPreflight } from './config/runtime-bootstrap';
import {
  createSearchRequestId,
  isSearchRoute,
  safeBuildIdentity,
  searchObservability,
  withSearchRequestContext,
} from './busqueda/search-observability';

async function bootstrap() {
  const { deploymentEnvironment, application: app } =
    await createApplicationAfterPreflight(process.env, () =>
      NestFactory.create(AppModule),
    );
  app.enableShutdownHooks();
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'SAMEORIGIN');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()',
    );
    next();
  });
  app.use((request: Request, response: Response, next: NextFunction) => {
    // Correlation IDs are generated here so a caller cannot inject a token,
    // identity, or other sensitive value into diagnostic logs.
    const requestId = createSearchRequestId();
    response.setHeader('X-Request-Id', requestId);
    const startedAt = performance.now();
    response.on('finish', () => {
      const routeMetadata = request.route as unknown as
        { path?: unknown } | undefined;
      const routePath = routeMetadata?.path;
      const route = typeof routePath === 'string' ? routePath : 'unmatched';
      const durationMs =
        Math.round((performance.now() - startedAt) * 100) / 100;
      const searchRoute = isSearchRoute(route, request.baseUrl);
      if (searchRoute) {
        searchObservability.recordHttpSearchCompletion(
          requestId,
          response.statusCode,
          durationMs,
        );
      } else if (response.statusCode >= 400) {
        const category =
          response.statusCode === 429
            ? 'rate_limited'
            : response.statusCode === 403
              ? 'acl_denied'
              : response.statusCode === 401
                ? 'authentication'
                : response.statusCode >= 500
                  ? 'server_error'
                  : 'client_error';
        console.warn(
          JSON.stringify({
            event: 'http_request',
            requestId,
            method: request.method,
            route,
            status: response.statusCode,
            durationMs,
            category,
          }),
        );
      }
    });
    withSearchRequestContext(requestId, next);
  });
  app.use(new LocalApiRateLimiter().middleware());
  app.useGlobalFilters(new SafeExceptionFilter());
  const port = Number(process.env.PORT ?? 4001);
  const bindHost =
    process.env.BJC_API_BIND_HOST ??
    (deploymentEnvironment === 'development' ? '127.0.0.1' : '0.0.0.0');
  const defaultFrontendOrigins = [
    'http://localhost:4002',
    'http://10.5.3.138:4002',
  ];
  const configuredFrontendOrigins = [
    process.env.FRONTEND_URL,
    ...(process.env.FRONTEND_URLS?.split(',') ?? []),
  ]
    .map((origin) => origin?.trim())
    .filter((origin): origin is string => Boolean(origin));
  const isProduction = deploymentEnvironment !== 'development';
  if (isProduction && configuredFrontendOrigins.length === 0) {
    throw new Error(
      'FRONTEND_URL o FRONTEND_URLS debe configurarse en producción.',
    );
  }
  const allowedOrigins = Array.from(
    new Set(
      isProduction
        ? configuredFrontendOrigins
        : [...defaultFrontendOrigins, ...configuredFrontendOrigins],
    ),
  );

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    exposedHeaders: [
      'Accept-Ranges',
      'Content-Disposition',
      'Content-Length',
      'Content-Range',
    ],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  if (process.env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Jurisprudencia Civil API')
      .setDescription('API inicial para Jurisprudencia Civil')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(port, bindHost);
  console.log(
    JSON.stringify({ event: 'build_identity', ...safeBuildIdentity() }),
  );
  console.log(`Backend escuchando en ${bindHost}:${port}/api`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`Swagger en http://localhost:${port}/api/docs`);
  }
  console.log(`CORS habilitado para: ${allowedOrigins.join(', ')}`);
}
void bootstrap();

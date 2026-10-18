import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
import { SafeExceptionFilter } from './safe-exception.filter';
import { LocalApiRateLimiter } from './rate-limit.middleware';
import { validatePreproductionConfig } from './config/preprod-config';

async function bootstrap() {
  if (process.env.NODE_ENV === 'production') {
    const deploymentEnvironment = process.env.BJC_DEPLOYMENT_ENV;
    if (
      deploymentEnvironment !== 'preprod' &&
      deploymentEnvironment !== 'production'
    ) {
      throw new Error(
        'En modo production debe declararse BJC_DEPLOYMENT_ENV=preprod o production.',
      );
    }
    if (deploymentEnvironment === 'preprod')
      validatePreproductionConfig(process.env);
  }
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'SAMEORIGIN');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()',
    );
    next();
  });
  app.use((request, response, next) => {
    const provided = request.get('x-request-id');
    const requestId =
      provided && /^[A-Za-z0-9._-]{8,80}$/u.test(provided)
        ? provided
        : randomUUID();
    response.setHeader('X-Request-Id', requestId);
    const startedAt = performance.now();
    response.on('finish', () => {
      const route = request.route?.path ?? 'unmatched';
      const durationMs =
        Math.round((performance.now() - startedAt) * 100) / 100;
      if (response.statusCode >= 400) {
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
      if (
        route === '/api/busqueda/avanzada' &&
        durationMs >= slowSearchThresholdMs()
      ) {
        console.warn(
          JSON.stringify({
            event: 'slow_search',
            requestId,
            route,
            durationMs,
            status: response.statusCode,
          }),
        );
      }
    });
    next();
  });
  app.use(new LocalApiRateLimiter().middleware());
  app.useGlobalFilters(new SafeExceptionFilter());
  const port = Number(process.env.PORT ?? 4001);
  const bindHost = process.env.BJC_API_BIND_HOST ?? '0.0.0.0';
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
  const isProduction = process.env.NODE_ENV === 'production';
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
  console.log(`Backend escuchando en ${bindHost}:${port}/api`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`Swagger en http://localhost:${port}/api/docs`);
  }
  console.log(`CORS habilitado para: ${allowedOrigins.join(', ')}`);
}

function slowSearchThresholdMs() {
  const configured = Number(process.env.BJC_SLOW_SEARCH_MS ?? 1500);
  return Number.isFinite(configured) &&
    configured >= 100 &&
    configured <= 60_000
    ? configured
    : 1500;
}
void bootstrap();

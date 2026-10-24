import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SafeExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const requestId = String(response.getHeader('X-Request-Id') ?? 'unknown');
    const route = (request as unknown as { route?: unknown }).route;
    const routePath =
      typeof route === 'object' &&
      route !== null &&
      'path' in route &&
      typeof route.path === 'string'
        ? route.path
        : 'unmatched';
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const safeMessage =
      status >= 500
        ? 'No se pudo completar la solicitud. Informá el identificador de seguimiento.'
        : exception instanceof HttpException
          ? exception.message
          : 'Solicitud inválida.';
    if (status >= 500)
      this.logger.error(
        JSON.stringify({
          event: 'request_failure',
          requestId,
          method: request.method,
          route: routePath,
          status,
          errorType: exception instanceof Error ? exception.name : 'unknown',
        }),
      );
    if (response.headersSent) return response.end();
    return response
      .status(status)
      .json({ statusCode: status, message: safeMessage, requestId });
  }
}

import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLES } from '../auth/constants';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import {
  ReviewPageVersionDto,
  SaveOcrReviewPageDto,
} from './ocr-human-review.dto';
import { safeContentDisposition } from './corpus-document-access.service';
import { OcrHumanReviewService } from './ocr-human-review.service';

@ApiTags('ocr-human-review')
@ApiBearerAuth()
@Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.REVISOR, ROLES.JURISPRUDENCIA)
@Controller('ocr-human-review')
export class OcrHumanReviewController {
  constructor(private readonly reviews: OcrHumanReviewService) {}

  @Get('queue')
  @ApiOperation({
    summary: 'Cola interna paginada de documentos que requieren OCR',
  })
  queue(
    @Query('filter') filter: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reviews.queue(
      filter ?? 'all',
      parsePositiveInt(page, 1),
      parsePositiveInt(pageSize, 25),
      user.id,
    );
  }

  @Post('documents/:documentId/open')
  @ApiOperation({
    summary: 'Abrir una revisión OCR elegible del Corpus institucional',
  })
  openDocument(
    @Param('documentId') documentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reviews.openDocument(documentId, user.id, user.rol.nombre);
  }

  @Get(':reviewId')
  @ApiOperation({
    summary: 'Obtener páginas, historial de OCR y estado de revisión',
  })
  details(
    @Param('reviewId') reviewId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reviews.reviewDetails(reviewId, user.id, user.rol.nombre);
  }

  @Post(':reviewId/assign')
  @ApiOperation({ summary: 'Tomar una revisión para trabajo individual' })
  assign(
    @Param('reviewId') reviewId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reviews.assignSelf(reviewId, user.id);
  }

  @Post(':reviewId/ocr')
  @ApiOperation({
    summary: 'Ejecutar OCR local y guardar el resultado como candidato',
  })
  generateOcr(
    @Param('reviewId') reviewId: string,
    @Body() body: { force?: boolean },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reviews.generateOcr(
      reviewId,
      user.id,
      user.rol.nombre,
      body?.force === true,
    );
  }

  @Get(':reviewId/file')
  @ApiOperation({
    summary:
      'Servir el PDF original de la revisión tras comprobar su acceso e integridad',
  })
  async file(
    @Param('reviewId') reviewId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
  ) {
    const original = await this.reviews.originalPdf(
      reviewId,
      user.id,
      user.rol.nombre,
    );
    response.setHeader('Content-Type', original.mimeType);
    response.setHeader('Content-Length', original.content.length);
    response.setHeader(
      'Content-Disposition',
      safeContentDisposition(original.filename, true),
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('ETag', '"' + original.sha256 + '"');
    return response.status(200).send(original.content);
  }

  @Post(':reviewId/pages/:pageNumber/save')
  @ApiOperation({
    summary: 'Guardar una corrección humana explícita con control optimista',
  })
  savePage(
    @Param('reviewId') reviewId: string,
    @Param('pageNumber', ParseIntPipe) pageNumber: number,
    @Body() body: SaveOcrReviewPageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reviews.savePage(
      reviewId,
      pageNumber,
      user.id,
      user.rol.nombre,
      body,
    );
  }

  @Post(':reviewId/pages/:pageNumber/approve')
  @ApiOperation({ summary: 'Aprobar explícitamente el texto de una página' })
  approvePage(
    @Param('reviewId') reviewId: string,
    @Param('pageNumber', ParseIntPipe) pageNumber: number,
    @Body() body: ReviewPageVersionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reviews.approvePage(
      reviewId,
      pageNumber,
      user.id,
      user.rol.nombre,
      body.expectedVersion,
    );
  }

  @Post(':reviewId/pages/:pageNumber/no-text')
  @ApiOperation({
    summary: 'Confirmar explícitamente que una página no contiene texto',
  })
  noText(
    @Param('reviewId') reviewId: string,
    @Param('pageNumber', ParseIntPipe) pageNumber: number,
    @Body() body: ReviewPageVersionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reviews.markNoText(
      reviewId,
      pageNumber,
      user.id,
      user.rol.nombre,
      body.expectedVersion,
    );
  }

  @Post(':reviewId/pages/:pageNumber/reject')
  @ApiOperation({ summary: 'Marcar una página para nueva revisión OCR' })
  rejectPage(
    @Param('reviewId') reviewId: string,
    @Param('pageNumber', ParseIntPipe) pageNumber: number,
    @Body() body: { expectedVersion: number; reason: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reviews.rejectPage(
      reviewId,
      pageNumber,
      user.id,
      user.rol.nombre,
      body,
    );
  }

  @Post(':reviewId/pages/:pageNumber/reopen')
  @ApiOperation({
    summary: 'Reabrir una página aprobada conservando la versión Search activa',
  })
  reopenPage(
    @Param('reviewId') reviewId: string,
    @Param('pageNumber', ParseIntPipe) pageNumber: number,
    @Body() body: { expectedVersion: number },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reviews.reopenPage(
      reviewId,
      pageNumber,
      user.id,
      user.rol.nombre,
      body.expectedVersion,
    );
  }

  @Post(':reviewId/approve')
  @ApiOperation({
    summary: 'Promover a Corpus Search solo páginas aprobadas por persona',
  })
  approveDocument(
    @Param('reviewId') reviewId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reviews.approveDocument(reviewId, user.id, user.rol.nombre);
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number) {
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

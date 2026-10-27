import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ROLES } from '../auth/constants';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import {
  safeContentDisposition,
  singleByteRange,
  CorpusDocumentAccessService,
} from './corpus-document-access.service';

@ApiTags('corpus')
@ApiBearerAuth()
@Roles(
  ROLES.ADMIN,
  ROLES.OPERADOR,
  ROLES.LECTOR,
  ROLES.REVISOR,
  ROLES.JURISPRUDENCIA,
  ROLES.DIGESTO,
)
@Controller('corpus/documents')
export class CorpusDocumentController {
  constructor(private readonly documents: CorpusDocumentAccessService) {}

  @Get('admin/summary')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR)
  @ApiOperation({
    summary: 'Resumen de inventario institucional Corpus para operadores',
  })
  institutionalSummary() {
    return this.documents.institutionalSummary();
  }

  @Get('admin/review')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.REVISOR, ROLES.JURISPRUDENCIA)
  @ApiOperation({ summary: 'Cola paginada de revisión documental' })
  institutionalReview(
    @Query('filter') filter: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
  ) {
    return this.documents.institutionalReviewQueue(
      filter ?? 'all',
      parsePage(page) ?? 1,
      parsePage(pageSize) ?? 50,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Metadata y procedencia de un documento Corpus' })
  metadata(
    @Param('id') id: string,
    @Query('pageNumber') pageNumber: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.metadata(
      id,
      user.rol.nombre === ROLES.ADMIN ? 'ADMIN' : 'INTERNAL',
      parseOptionalPage(pageNumber),
    );
  }

  @Get(':id/matches')
  @ApiOperation({
    summary: 'Busca coincidencias dentro de las páginas de un documento Corpus',
  })
  matches(
    @Param('id') id: string,
    @Query('q') query: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.matches(
      id,
      user.rol.nombre === ROLES.ADMIN ? 'ADMIN' : 'INTERNAL',
      query ?? '',
    );
  }

  @Get(':id/citation')
  @ApiOperation({
    summary: 'Forma una cita con página a partir del documento autorizado',
  })
  citation(
    @Param('id') id: string,
    @Query('page') page: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const pageNumber = parseOptionalPage(page);
    if (pageNumber === undefined)
      throw new BadRequestException('La página debe ser un entero positivo.');
    return this.documents.citation(
      id,
      user.rol.nombre === ROLES.ADMIN ? 'ADMIN' : 'INTERNAL',
      pageNumber,
    );
  }

  @Get(':id/structure')
  @ApiOperation({
    summary: 'Detecta secciones con texto extraído del documento',
  })
  structure(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.documents.structure(
      id,
      user.rol.nombre === ROLES.ADMIN ? 'ADMIN' : 'INTERNAL',
    );
  }

  @Get(':id/file')
  @ApiOperation({
    summary: 'Lee el archivo Corpus respetando permisos y rangos HTTP',
  })
  async file(
    @Param('id') id: string,
    @Query('download') download: string | undefined,
    @Headers('range') range: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
  ) {
    return sendDocument(
      response,
      await this.documents.file(
        id,
        user.rol.nombre === ROLES.ADMIN ? 'ADMIN' : 'INTERNAL',
      ),
      download === 'true',
      range,
    );
  }
}

@ApiTags('public-corpus')
@Public()
@Controller('public/corpus/documents')
export class PublicCorpusDocumentController {
  constructor(private readonly documents: CorpusDocumentAccessService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Metadata pública de un documento Corpus' })
  metadata(
    @Param('id') id: string,
    @Query('pageNumber') pageNumber: string | undefined,
  ) {
    return this.documents.metadata(id, 'PUBLIC', parseOptionalPage(pageNumber));
  }

  @Get(':id/structure')
  @ApiOperation({ summary: 'Detecta secciones de un documento público' })
  structure(@Param('id') id: string) {
    return this.documents.structure(id, 'PUBLIC');
  }

  @Get(':id/file')
  @ApiOperation({ summary: 'Lee un archivo Corpus público' })
  async file(
    @Param('id') id: string,
    @Query('download') download: string | undefined,
    @Headers('range') range: string | undefined,
    @Res() response: Response,
  ) {
    return sendDocument(
      response,
      await this.documents.file(id, 'PUBLIC'),
      download === 'true',
      range,
    );
  }
}

function parsePage(value?: string) {
  if (value === undefined) return undefined;
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : undefined;
}

function parseOptionalPage(value?: string) {
  if (value === undefined) return undefined;
  const page = Number(value);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100_000) {
    throw new BadRequestException('La página debe ser un entero positivo.');
  }
  return page;
}

export function sendDocument(
  response: Response,
  file: { content: Buffer; filename: string; mimeType: string },
  download: boolean,
  rangeHeader?: string,
) {
  const range = singleByteRange(rangeHeader, file.content.length);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Content-Type', file.mimeType);
  response.setHeader(
    'Content-Disposition',
    safeContentDisposition(
      file.filename,
      !download && file.mimeType === 'application/pdf',
    ),
  );
  if (range.status === 416) {
    response.setHeader('Content-Range', `bytes */${file.content.length}`);
    return response.status(416).send();
  }
  const body =
    range.status === 206
      ? file.content.subarray(range.start, range.end + 1)
      : file.content;
  response.setHeader('Content-Length', String(body.length));
  if (range.status === 206)
    response.setHeader(
      'Content-Range',
      `bytes ${range.start}-${range.end}/${file.content.length}`,
    );
  return response.status(range.status).send(body);
}

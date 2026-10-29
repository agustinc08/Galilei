import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLES } from '../auth/constants';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import {
  safeContentDisposition,
  singleByteRange,
  CorpusDocumentAccessService,
} from './corpus-document-access.service';
import { WorkspaceDocumentService } from './workspace-document.service';

const PERSONAL_DOCUMENT_UPLOAD_LIMITS = {
  fileSize: 20 * 1024 * 1024,
  files: 20,
  fieldArrayIndexLimit: 20,
  // Browsers encode multipart filenames as UTF-8; Multer otherwise defaults to Latin-1.
  defParamCharset: 'utf8',
};

@ApiTags('personal-documents')
@ApiBearerAuth()
@Roles(
  ROLES.ADMIN,
  ROLES.OPERADOR,
  ROLES.LECTOR,
  ROLES.REVISOR,
  ROLES.JURISPRUDENCIA,
  ROLES.DIGESTO,
)
@Controller('personal')
export class PersonalDocumentController {
  constructor(
    private readonly documents: WorkspaceDocumentService,
    private readonly corpusDocuments: CorpusDocumentAccessService,
  ) {}

  @Get('folders')
  folders(@CurrentUser() user: AuthenticatedUser) {
    return this.documents.personalFolders(user);
  }

  @Post('folders')
  @ApiOperation({
    summary: 'Crea una carpeta personal sólo visible para quien inició sesión',
  })
  createFolder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { name: string; parentId?: string | null },
  ) {
    return this.documents.createPersonalFolder(user, body);
  }

  @Patch('folders/:id')
  renameFolder(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { name: string },
  ) {
    return this.documents.renamePersonalFolder(id, user, body);
  }

  @Get('documents')
  documentsInPersonal(
    @CurrentUser() user: AuthenticatedUser,
    @Query('folderId') folderId?: string,
  ) {
    return this.documents.personalDocuments(
      user,
      folderId === 'ROOT' ? null : (folderId ?? null),
    );
  }

  @Post('documents/upload')
  @UseInterceptors(
    FilesInterceptor('files', 20, {
      limits: PERSONAL_DOCUMENT_UPLOAD_LIMITS,
    }),
  )
  @ApiOperation({
    summary:
      'Carga documentos personales; el propietario siempre es la identidad autenticada',
  })
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFiles()
    files: Array<{
      originalname: string;
      mimetype: string;
      buffer: Buffer;
      size: number;
    }>,
    @Query('folderId') folderId?: string,
  ) {
    return this.documents.uploadPersonal(user, files, folderId);
  }

  @Post('documents/folder-upload')
  @UseInterceptors(
    FilesInterceptor('files', 20, {
      limits: PERSONAL_DOCUMENT_UPLOAD_LIMITS,
    }),
  )
  @ApiOperation({
    summary:
      'Carga en lote archivos PDF y Word de una carpeta personal seleccionada en el navegador',
  })
  uploadFolder(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFiles()
    files: Array<{
      originalname: string;
      mimetype: string;
      buffer: Buffer;
      size: number;
    }>,
    @Query('folderId') folderId?: string,
  ) {
    return this.documents.uploadPersonalFolder(user, files, folderId);
  }

  @Get('search')
  search(
    @CurrentUser() user: AuthenticatedUser,
    @Query('q') q: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Query('folderId') folderId: string | undefined,
  ) {
    return this.documents.searchPersonal(
      user,
      q ?? '',
      positiveInt(page, 1),
      Math.min(100, positiveInt(pageSize, 20)),
      folderId === 'ROOT' ? null : folderId,
    );
  }

  @Patch('documents/:id/share')
  @ApiOperation({
    summary:
      'Comparte un documento personal con una dependencia tras confirmación explícita',
  })
  share(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      workspaceId: string;
      folderId?: string | null;
      confirmAccessChange: boolean;
    },
  ) {
    return this.documents.sharePersonalDocument(id, user, body);
  }

  @Delete('documents/:id')
  @ApiOperation({
    summary: 'Elimina un documento personal de la cuenta autenticada',
  })
  deleteDocument(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body?: { reason?: string },
  ) {
    return this.documents.deletePersonalDocument(id, user, body?.reason ?? '');
  }

  @Get('documents/:id')
  metadata(
    @Param('id') id: string,
    @Query('pageNumber') page: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.personalMetadata(
      id,
      user,
      page ? positiveInt(page, 1) : undefined,
    );
  }

  @Get('documents/:id/structure')
  @ApiOperation({ summary: 'Detecta secciones con ACL del documento personal' })
  structure(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.corpusDocuments.structure(id, 'RESTRICTED', undefined, user.id);
  }

  @Get('documents/:id/matches')
  matches(
    @Param('id') id: string,
    @Query('q') q: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.personalMatches(id, user, q ?? '');
  }

  @Get('documents/:id/file')
  async file(
    @Param('id') id: string,
    @Query('download') download: string | undefined,
    @Headers('range') range: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
  ) {
    const result = await this.documents.personalFile(id, user);
    const byteRange = singleByteRange(range, result.content.length);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Type', result.mimeType);
    response.setHeader(
      'Content-Disposition',
      safeContentDisposition(result.filename, download !== 'true'),
    );
    if (byteRange.status === 416) {
      response.setHeader('Content-Range', `bytes */${result.content.length}`);
      return response.status(416).send();
    }
    const content =
      byteRange.status === 206
        ? result.content.subarray(byteRange.start, byteRange.end + 1)
        : result.content;
    response.setHeader('Content-Length', String(content.length));
    if (byteRange.status === 206)
      response.setHeader(
        'Content-Range',
        `bytes ${byteRange.start}-${byteRange.end}/${result.content.length}`,
      );
    return response.status(byteRange.status).send(content);
  }
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

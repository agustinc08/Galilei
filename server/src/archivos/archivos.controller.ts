import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { statSync } from 'node:fs';
import { ROLES } from '../auth/constants';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { ArchivosService } from './archivos.service';

function sendPdfFile(req: Request, res: Response, absolutePath: string) {
  const size = statSync(absolutePath).size;
  const range = req.range(size);
  if (range === -1 || range === -2) {
    res.setHeader('Content-Range', `bytes */${size}`);
    return res.status(416).end();
  }

  return res.sendFile(absolutePath);
}

@ApiTags('archivos')
@ApiBearerAuth()
@Roles(ROLES.ADMIN, ROLES.OPERADOR)
@Controller('archivos')
export class ArchivosController {
  constructor(private readonly archivosService: ArchivosService) {}

  @Post('upload/sentencia/:sentenciaId')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiOperation({ summary: 'Sube un PDF asociado a una sentencia' })
  uploadSentenciaPdf(
    @Param('sentenciaId', ParseIntPipe) sentenciaId: number,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.archivosService.uploadSentenciaPdf(sentenciaId, file, user.id);
  }

  @Post('upload/jurisprudencia')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.JURISPRUDENCIA)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Incorpora un PDF y crea un borrador de Jurisprudencia',
  })
  uploadJurisprudenciaDraft(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.archivosService.uploadJurisprudenciaDraft(file, user.id);
  }

  @Get('sentencia/:sentenciaId')
  @ApiOperation({ summary: 'Lista PDFs de una sentencia' })
  findBySentencia(@Param('sentenciaId', ParseIntPipe) sentenciaId: number) {
    return this.archivosService.findBySentencia(sentenciaId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtiene metadata de un PDF' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.archivosService.findOne(id);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Descarga un PDF' })
  async download(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { archivo, absolutePath } = await this.archivosService.getDownload(
      id,
      user.id,
    );

    res.setHeader('Content-Type', archivo.mimeType ?? 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${archivo.nombreOriginal ?? archivo.nombreArchivo}"`,
    );

    return sendPdfFile(req, res, absolutePath);
  }

  @Delete(':id')
  @Roles(ROLES.ADMIN)
  @ApiOperation({ summary: 'Elimina metadata y archivo fisico si existe' })
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.archivosService.remove(id, user.id);
  }
}

@ApiTags('public-archivos')
@Public()
@Controller('public/sentencias')
export class PublicArchivosController {
  constructor(private readonly archivosService: ArchivosService) {}

  @Get(':slug/pdf')
  @ApiOperation({ summary: 'Abre el PDF público principal de una sentencia' })
  async downloadPublicPdf(
    @Param('slug') slug: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { archivo, absolutePath } =
      await this.archivosService.getPublicPdfByIdentifier(slug);

    res.setHeader('Content-Type', archivo.mimeType ?? 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${archivo.nombreOriginal ?? archivo.nombreArchivo}"`,
    );

    return sendPdfFile(req, res, absolutePath);
  }
}

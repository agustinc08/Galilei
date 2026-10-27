import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { ROLES } from '../auth/constants';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import {
  ConfirmInstitutionalMetadataDto,
  LinkInstitutionalIngestionDto,
} from './institutional-ingestion.dto';
import { InstitutionalIngestionService } from './institutional-ingestion.service';

@ApiTags('institutional-ingestion')
@ApiBearerAuth()
@Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.REVISOR, ROLES.JURISPRUDENCIA)
@Controller('corpus/institutional-ingestions')
export class InstitutionalIngestionController {
  constructor(private readonly ingestion: InstitutionalIngestionService) {}

  @Post('upload')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.JURISPRUDENCIA)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 100 * 1024 * 1024, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  upload(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.ingestion.upload(
      file,
      { id: user.id, role: user.rol.nombre },
      idempotencyKey,
    );
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
  ) {
    return this.ingestion.list(
      { id: user.id, role: user.rol.nombre },
      { page, pageSize, status, q },
    );
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ingestion.get(id, { id: user.id, role: user.rol.nombre });
  }

  @Patch(':id/metadata')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.JURISPRUDENCIA)
  confirmMetadata(
    @Param('id') id: string,
    @Body() body: ConfirmInstitutionalMetadataDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ingestion.confirmMetadata(id, body, {
      id: user.id,
      role: user.rol.nombre,
    });
  }

  @Post(':id/link')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.JURISPRUDENCIA)
  link(
    @Param('id') id: string,
    @Body() body: LinkInstitutionalIngestionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ingestion.linkExisting(id, body.sentenciaId, {
      id: user.id,
      role: user.rol.nombre,
    });
  }

  @Post(':id/draft')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.JURISPRUDENCIA)
  createDraft(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ingestion.createDraft(id, {
      id: user.id,
      role: user.rol.nombre,
    });
  }

  @Post(':id/cancel')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.JURISPRUDENCIA)
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ingestion.cancel(id, { id: user.id, role: user.rol.nombre });
  }

  @Post(':id/retry-extraction')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.JURISPRUDENCIA)
  retryExtraction(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ingestion.retryExtraction(id, {
      id: user.id,
      role: user.rol.nombre,
    });
  }
}

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLES } from '../auth/constants';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { DocumentSourceService } from './document-source.service';

@ApiTags('document-sources')
@ApiBearerAuth()
@Roles(
  ROLES.ADMIN,
  ROLES.OPERADOR,
  ROLES.LECTOR,
  ROLES.REVISOR,
  ROLES.JURISPRUDENCIA,
  ROLES.DIGESTO,
)
@Controller('workspaces/:workspaceId/sources')
export class DocumentSourceController {
  constructor(private readonly sources: DocumentSourceService) {}

  @Post('test-access')
  @ApiOperation({ summary: 'Prueba el acceso del proceso a una carpeta UNC' })
  testAccess(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { path?: string },
  ) {
    return this.sources.testAccess(workspaceId, user, body.path ?? '');
  }

  @Get()
  list(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sources.list(workspaceId, user);
  }

  @Post()
  create(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { name?: string; path?: string },
  ) {
    return this.sources.create(workspaceId, user, body);
  }

  @Get(':sourceId')
  get(
    @Param('workspaceId') workspaceId: string,
    @Param('sourceId') sourceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sources.get(workspaceId, sourceId, user);
  }

  @Patch(':sourceId')
  update(
    @Param('workspaceId') workspaceId: string,
    @Param('sourceId') sourceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { name?: string; path?: string; enabled?: boolean },
  ) {
    return this.sources.update(workspaceId, sourceId, user, body);
  }

  @Post(':sourceId/scan')
  scan(
    @Param('workspaceId') workspaceId: string,
    @Param('sourceId') sourceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sources.scan(workspaceId, sourceId, user);
  }

  @Get(':sourceId/runs')
  runs(
    @Param('workspaceId') workspaceId: string,
    @Param('sourceId') sourceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sources.runs(workspaceId, sourceId, user);
  }

  @Get(':sourceId/files')
  files(
    @Param('workspaceId') workspaceId: string,
    @Param('sourceId') sourceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') rawPage?: string,
  ) {
    const page = Number(rawPage);
    return this.sources.files(
      workspaceId,
      sourceId,
      user,
      Number.isSafeInteger(page) && page > 0 ? page : 1,
    );
  }
}

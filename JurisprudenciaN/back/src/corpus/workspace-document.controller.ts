import {
  Body,
  Controller,
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
import {
  WorkspaceDependencyType,
  WorkspaceRole,
  WorkspaceVisibilityScope,
} from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLES } from '../auth/constants';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import {
  safeContentDisposition,
  singleByteRange,
} from './corpus-document-access.service';
import { WorkspaceDocumentService } from './workspace-document.service';

const WORKSPACE_DOCUMENT_UPLOAD_LIMITS = {
  fileSize: 20 * 1024 * 1024,
  files: 20,
  fieldArrayIndexLimit: 20,
};

@ApiTags('document-workspaces')
@ApiBearerAuth()
@Roles(
  ROLES.ADMIN,
  ROLES.OPERADOR,
  ROLES.LECTOR,
  ROLES.REVISOR,
  ROLES.JURISPRUDENCIA,
  ROLES.DIGESTO,
)
@Controller('workspaces')
export class WorkspaceDocumentController {
  constructor(private readonly workspaces: WorkspaceDocumentService) {}

  @Get('mine')
  @ApiOperation({
    summary: 'Lista espacios con membresía explícita del usuario',
  })
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.workspaces.mine(user);
  }

  @Get('admin/list')
  @Roles(ROLES.ADMIN)
  administered(@CurrentUser() user: AuthenticatedUser) {
    return this.workspaces.administeredWorkspaces(user);
  }

  @Patch('admin/:workspaceId/active')
  @Roles(ROLES.ADMIN)
  setActive(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { active: boolean },
  ) {
    return this.workspaces.setWorkspaceActive(workspaceId, user, body.active);
  }

  @Post()
  @Roles(ROLES.ADMIN)
  @ApiOperation({
    summary: 'Crea un espacio documental privado asociado a una dependencia',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { code: string; name: string; type: WorkspaceDependencyType },
  ) {
    return this.workspaces.createWorkspace(user, body);
  }

  @Get(':workspaceId/folders')
  folders(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspaces.folders(workspaceId, user);
  }

  @Post(':workspaceId/folders')
  createFolder(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      name: string;
      parentId?: string | null;
      visibilityScope?: WorkspaceVisibilityScope;
      userIds?: number[];
    },
  ) {
    return this.workspaces.createFolder(workspaceId, user, body);
  }

  @Patch(':workspaceId/folders/:folderId/access')
  setRestrictedFolderMembers(
    @Param('workspaceId') workspaceId: string,
    @Param('folderId') folderId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      userIds?: number[];
      visibilityScope?: WorkspaceVisibilityScope;
      confirmAccessChange?: boolean;
    },
  ) {
    return this.workspaces.setRestrictedFolderMembers(
      workspaceId,
      folderId,
      user,
      body,
    );
  }

  @Get(':workspaceId/folders/:folderId/access')
  restrictedFolderMembers(
    @Param('workspaceId') workspaceId: string,
    @Param('folderId') folderId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspaces.restrictedFolderMembers(workspaceId, folderId, user);
  }

  @Patch(':workspaceId/folders/:folderId')
  renameFolder(
    @Param('workspaceId') workspaceId: string,
    @Param('folderId') folderId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { name: string },
  ) {
    return this.workspaces.renameFolder(workspaceId, folderId, user, body);
  }

  @Get(':workspaceId/documents')
  documents(
    @Param('workspaceId') workspaceId: string,
    @Query('folderId') folderId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspaces.documentsInWorkspace(
      workspaceId,
      user,
      folderId === 'ROOT' ? null : folderId,
    );
  }

  @Patch(':workspaceId/documents/:id/folder')
  moveDocument(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: { folderId?: string | null; confirmVisibilityChange?: boolean },
  ) {
    return this.workspaces.moveDocument(
      workspaceId,
      id,
      user,
      body.folderId,
      body.confirmVisibilityChange,
    );
  }

  @Patch(':workspaceId/documents/:id/personal')
  makeDocumentPersonal(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { folderId?: string | null; confirmAccessChange: boolean },
  ) {
    return this.workspaces.makeDocumentPersonal(workspaceId, id, user, body);
  }

  @Post(':workspaceId/documents/upload')
  @UseInterceptors(
    FilesInterceptor('files', 20, {
      limits: WORKSPACE_DOCUMENT_UPLOAD_LIMITS,
    }),
  )
  upload(
    @Param('workspaceId') workspaceId: string,
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
    return this.workspaces.upload(workspaceId, user, files, folderId);
  }

  @Get(':workspaceId/search')
  search(
    @Param('workspaceId') workspaceId: string,
    @Query('q') q: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Query('folderId') folderId: string | undefined,
    @Query('sourceId') sourceId: string | undefined,
    @Query('sourceFolder') sourceFolder: string | undefined,
    @Query('type') type: string | undefined,
    @Query('dateFrom') dateFrom: string | undefined,
    @Query('dateTo') dateTo: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspaces.searchWorkspace(
      workspaceId,
      user,
      q ?? '',
      positiveInt(page, 1),
      Math.min(100, positiveInt(pageSize, 20)),
      folderId === 'ROOT' ? null : folderId,
      sourceId,
      sourceFolder,
      { type, dateFrom, dateTo },
    );
  }

  @Get(':workspaceId/search/sources')
  searchSources(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspaces.searchSources(workspaceId, user);
  }

  @Get(':workspaceId/search/sources/:sourceId/folders')
  searchSourceFolders(
    @Param('workspaceId') workspaceId: string,
    @Param('sourceId') sourceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspaces.searchSourceFolders(workspaceId, sourceId, user);
  }

  @Get(':workspaceId/member-candidates')
  memberCandidates(
    @Param('workspaceId') workspaceId: string,
    @Query('q') q: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspaces.memberCandidates(workspaceId, user, q ?? '');
  }

  @Get(':workspaceId/membership-candidates')
  membershipCandidates(
    @Param('workspaceId') workspaceId: string,
    @Query('q') q: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspaces.membershipCandidates(workspaceId, user, q ?? '');
  }

  @Get(':workspaceId/search/names')
  searchNames(
    @Param('workspaceId') workspaceId: string,
    @Query('q') q: string | undefined,
    @Query('folderId') folderId: string | undefined,
    @Query('sourceId') sourceId: string | undefined,
    @Query('sourceFolder') sourceFolder: string | undefined,
    @Query('type') type: string | undefined,
    @Query('dateFrom') dateFrom: string | undefined,
    @Query('dateTo') dateTo: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspaces.searchNames(
      workspaceId,
      user,
      q ?? '',
      folderId === 'ROOT' ? null : folderId,
      positiveInt(page, 1),
      Math.min(100, positiveInt(pageSize, 20)),
      sourceId,
      sourceFolder,
      { type, dateFrom, dateTo },
    );
  }

  @Get(':workspaceId/documents/:id')
  metadata(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Query('pageNumber') page: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspaces.metadata(
      workspaceId,
      id,
      user,
      page ? positiveInt(page, 1) : undefined,
    );
  }

  @Get(':workspaceId/documents/:id/matches')
  matches(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Query('q') q: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspaces.matches(workspaceId, id, user, q ?? '');
  }

  @Get(':workspaceId/documents/:id/file')
  async file(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Query('download') download: string | undefined,
    @Headers('range') range: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
  ) {
    const result = await this.workspaces.file(workspaceId, id, user);
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

  @Post(':workspaceId/members')
  upsertMember(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { userId: number; role: WorkspaceRole; active?: boolean },
  ) {
    return this.workspaces.manageMember(workspaceId, user, body);
  }

  @Get(':workspaceId/members')
  members(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspaces.members(workspaceId, user);
  }

  @Get(':workspaceId/activity')
  activity(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspaces.activity(workspaceId, user);
  }
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ROLES } from '../auth/constants';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CollectionItemsQueryDto } from './dto/collection-items-query.dto';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import { UpdateCollectionNoteDto } from './dto/update-collection-note.dto';
import { ResearchCollectionsService } from './research-collections.service';

@ApiTags('research-collections')
@ApiBearerAuth()
@Roles(
  ROLES.ADMIN,
  ROLES.OPERADOR,
  ROLES.LECTOR,
  ROLES.REVISOR,
  ROLES.JURISPRUDENCIA,
  ROLES.DIGESTO,
)
@Controller('research/collections')
export class ResearchCollectionsController {
  constructor(private readonly collections: ResearchCollectionsService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista únicamente las colecciones personales del usuario',
  })
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.collections.findAll(user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Crea una colección privada del usuario' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCollectionDto,
  ) {
    return this.collections.create(user.id, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Abre una colección propia y sus referencias publicadas',
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: CollectionItemsQueryDto,
  ) {
    return this.collections.findOne(user.id, id, query);
  }

  @Post(':id/export')
  @ApiOperation({
    summary: 'Exporta la colección propia como un dossier ZIP verificable',
  })
  async exportBundle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) response: Response,
  ) {
    const bundle = await this.collections.exportBundle(user.id, id);
    response.setHeader('Content-Type', 'application/zip');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${bundle.filename}"`,
    );
    response.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(bundle.stream);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Renombra una colección propia' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCollectionDto,
  ) {
    return this.collections.update(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Elimina una colección y sus referencias, no los fallos',
  })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.collections.remove(user.id, id);
  }

  @Post(':id/items/:sentenciaId')
  @ApiOperation({
    summary:
      'Agrega de manera idempotente un fallo publicado a una colección propia',
  })
  addJudgment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) collectionId: number,
    @Param('sentenciaId', ParseIntPipe) sentenciaId: number,
  ) {
    return this.collections.addJudgment(user.id, collectionId, sentenciaId);
  }

  @Delete(':id/items/:itemId')
  @ApiOperation({ summary: 'Quita una referencia de una colección propia' })
  removeJudgment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) collectionId: number,
    @Param('itemId', ParseIntPipe) itemId: number,
  ) {
    return this.collections.removeJudgment(user.id, collectionId, itemId);
  }

  @Patch(':id/items/:itemId/note')
  @ApiOperation({
    summary:
      'Actualiza la nota privada del usuario para un fallo en su colección',
  })
  updateNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) collectionId: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: UpdateCollectionNoteDto,
  ) {
    return this.collections.updateNote(user.id, collectionId, itemId, dto);
  }
}

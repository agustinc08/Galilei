import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLES } from '../auth/constants';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CorpusCurationService } from './corpus-curation.service';

@ApiTags('corpus-curation')
@ApiBearerAuth()
@Roles(
  ROLES.ADMIN,
  ROLES.OPERADOR,
  ROLES.LECTOR,
  ROLES.REVISOR,
  ROLES.JURISPRUDENCIA,
  ROLES.DIGESTO,
)
@Controller('corpus/curation')
export class CorpusCurationController {
  constructor(private readonly curation: CorpusCurationService) {}

  @Get('documents/:id')
  document(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.curation.document(id, user.rol.nombre === ROLES.ADMIN);
  }

  @Patch('associations/:id')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.REVISOR, ROLES.JURISPRUDENCIA)
  association(
    @Param('id') id: string,
    @Body() body: { status: 'APPROVED' | 'REJECTED' },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.curation.reviewAssociation(
      id,
      body.status,
      user.id,
      user.rol.nombre === ROLES.ADMIN,
    );
  }

  @Patch('classifications/:id')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.REVISOR, ROLES.JURISPRUDENCIA)
  classification(
    @Param('id') id: string,
    @Body()
    body: {
      status: 'APPROVED' | 'REJECTED';
      category?: string;
      value?: string;
    },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.curation.reviewClassification(
      id,
      body.status,
      user.id,
      user.rol.nombre === ROLES.ADMIN,
      body.category,
      body.value,
    );
  }

  @Post('classifications/batch')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.REVISOR, ROLES.JURISPRUDENCIA)
  batch(
    @Body() body: { ids: string[]; status: 'APPROVED' | 'REJECTED' },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.curation.batchClassifications(
      body.ids,
      body.status,
      user.id,
      user.rol.nombre === ROLES.ADMIN,
    );
  }

  @Post('classifications/:id/revert')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.REVISOR, ROLES.JURISPRUDENCIA)
  revertClassification(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.curation.revertClassification(
      id,
      body.reason ?? '',
      user.id,
      user.rol.nombre === ROLES.ADMIN,
    );
  }

  @Post('documents/jurisprudence/review-pending/batch/preview')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.JURISPRUDENCIA)
  previewBatchJurisprudence(
    @Body() body: { documentIds: string[] },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.curation.previewBatchJurisprudenceReview(
      body.documentIds,
      user.rol.nombre === ROLES.ADMIN,
    );
  }

  @Post('documents/jurisprudence/review-pending/batch')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.JURISPRUDENCIA)
  batchJurisprudence(
    @Body() body: { documentIds: string[] },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.curation.batchJurisprudenceReview(
      body.documentIds,
      user.id,
      user.rol.nombre === ROLES.ADMIN,
    );
  }

  @Patch('documents/:id/jurisprudence')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.JURISPRUDENCIA)
  jurisprudence(
    @Param('id') id: string,
    @Body()
    body: {
      status: 'REVIEW_PENDING' | 'SELECTED' | 'NOT_SELECTED';
      reason?: string;
      note?: string;
    },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.curation.setJurisprudence(
      id,
      body.status,
      body.reason,
      body.note,
      user.id,
      user.rol.nombre === ROLES.ADMIN,
    );
  }

  @Get('digesto/collections')
  collections(@CurrentUser() user: AuthenticatedUser) {
    return this.curation.collections(user.rol.nombre === ROLES.ADMIN);
  }

  @Get('digesto/collections/:id')
  collection(@Param('id') id: string) {
    return this.curation.collection(id);
  }

  @Post('digesto/collections/:id/memberships/preview')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.DIGESTO)
  previewBatchMembership(
    @Param('id') id: string,
    @Body() body: { documentIds: string[] },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.curation.previewBatchMembership(
      id,
      body.documentIds,
      user.rol.nombre === ROLES.ADMIN,
    );
  }

  @Post('digesto/collections/:id/memberships')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.DIGESTO)
  batchMembership(
    @Param('id') id: string,
    @Body() body: { documentIds: string[] },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.curation.batchMembership(
      id,
      body.documentIds,
      user.id,
      user.rol.nombre === ROLES.ADMIN,
    );
  }

  @Get('digesto/topics')
  topics() {
    return this.curation.topics();
  }

  @Get('digesto/tags')
  tags() {
    return this.curation.tags();
  }

  @Post('digesto/collections')
  @Roles(ROLES.ADMIN, ROLES.DIGESTO)
  createCollection(
    @Body() body: { name: string; description?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.curation.createCollection(body.name, body.description, user.id);
  }

  @Post('digesto/topics')
  @Roles(ROLES.ADMIN, ROLES.DIGESTO)
  createTopic(
    @Body() body: { name: string; description?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.curation.createTopic(body.name, body.description, user.id);
  }

  @Post('digesto/tags')
  @Roles(ROLES.ADMIN, ROLES.DIGESTO)
  createTag(
    @Body() body: { name: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.curation.createTag(body.name, user.id);
  }

  @Post('documents/:id/digesto/collections/:collectionId')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.DIGESTO)
  addCollection(
    @Param('id') id: string,
    @Param('collectionId') collectionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.curation.addToCollection(
      id,
      collectionId,
      user.id,
      user.rol.nombre === ROLES.ADMIN,
    );
  }

  @Delete('documents/:id/digesto/collections/:collectionId')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.DIGESTO)
  removeCollection(
    @Param('id') id: string,
    @Param('collectionId') collectionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.curation.removeFromCollection(
      id,
      collectionId,
      user.id,
      user.rol.nombre === ROLES.ADMIN,
    );
  }

  @Post('documents/:id/digesto/topics/:topicId')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.DIGESTO)
  addTopic(
    @Param('id') id: string,
    @Param('topicId') topicId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.curation.addTopic(
      id,
      topicId,
      user.id,
      user.rol.nombre === ROLES.ADMIN,
    );
  }

  @Delete('documents/:id/digesto/topics/:topicId')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.DIGESTO)
  removeTopic(
    @Param('id') id: string,
    @Param('topicId') topicId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.curation.removeTopic(
      id,
      topicId,
      user.id,
      user.rol.nombre === ROLES.ADMIN,
    );
  }

  @Post('documents/:id/digesto/tags/:tagId')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.DIGESTO)
  addTag(
    @Param('id') id: string,
    @Param('tagId') tagId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.curation.addTag(
      id,
      tagId,
      user.id,
      user.rol.nombre === ROLES.ADMIN,
    );
  }

  @Delete('documents/:id/digesto/tags/:tagId')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.DIGESTO)
  removeTag(
    @Param('id') id: string,
    @Param('tagId') tagId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.curation.removeTag(
      id,
      tagId,
      user.id,
      user.rol.nombre === ROLES.ADMIN,
    );
  }
}

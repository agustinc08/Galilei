import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLES } from '../auth/constants';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { RelationshipCandidatesQueryDto } from './dto/relationship-candidates-query.dto';
import { ReviewRelationshipCandidateDto } from './dto/review-relationship-candidate.dto';
import { ResearchRelationshipsService } from './research-relationships.service';

@ApiTags('research-citation-review')
@ApiBearerAuth()
@Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.JURISPRUDENCIA, ROLES.REVISOR)
@Controller('research/citation-candidates')
export class ResearchRelationshipsController {
  constructor(private readonly relationships: ResearchRelationshipsService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista las citas detectadas para revisión editorial',
  })
  list(@Query() query: RelationshipCandidatesQueryDto) {
    return this.relationships.listCandidates(query);
  }

  @Post(':sentenciaId/extract')
  @ApiOperation({
    summary: 'Detecta identificadores explícitos de citas en una ficha',
  })
  extract(@Param('sentenciaId', ParseIntPipe) sentenciaId: number) {
    return this.relationships.extractForSentence(sentenciaId);
  }

  @Patch(':id/review')
  @ApiOperation({
    summary: 'Confirma, rechaza o deja sin resolver una cita candidata',
  })
  review(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReviewRelationshipCandidateDto,
  ) {
    return this.relationships.reviewCandidate(id, user.id, dto);
  }
}

@ApiTags('public-sentencias')
@Public()
@Controller('public/sentencias')
export class PublicResearchRelationshipsController {
  constructor(private readonly relationships: ResearchRelationshipsService) {}

  @Get(':slug/relaciones-verificadas')
  @ApiOperation({ summary: 'Lista citas verificadas entre fallos publicados' })
  findVerified(@Param('slug') slug: string) {
    return this.relationships.findPublicVerifiedRelationships(slug);
  }
}

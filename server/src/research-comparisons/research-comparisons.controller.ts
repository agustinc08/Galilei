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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLES } from '../auth/constants';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public as PublicRoute } from '../auth/decorators/public.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CreateComparisonDto } from './dto/create-comparison.dto';
import { UpdateComparisonDto } from './dto/update-comparison.dto';
import { ResearchComparisonsService } from './research-comparisons.service';

const PERSONAL_RESEARCH_ROLES = [
  ROLES.ADMIN,
  ROLES.OPERADOR,
  ROLES.LECTOR,
  ROLES.REVISOR,
  ROLES.JURISPRUDENCIA,
  ROLES.DIGESTO,
] as const;

@ApiTags('research-comparisons')
@ApiBearerAuth()
@Controller('research/comparisons')
export class ResearchComparisonsController {
  constructor(private readonly comparisons: ResearchComparisonsService) {}

  @Get('resolve')
  @PublicRoute()
  @ApiOperation({ summary: 'Resuelve una comparación de fallos públicos' })
  resolve(@Query('ids') ids: string | undefined) {
    return this.comparisons.resolvePublic(ids);
  }

  @Get('notes')
  @Roles(...PERSONAL_RESEARCH_ROLES)
  @ApiOperation({ summary: 'Lista notas propias de fallos comparados' })
  notes(
    @CurrentUser() user: AuthenticatedUser,
    @Query('slugs') slugs: string | undefined,
  ) {
    return this.comparisons.findOwnedNotes(user.id, slugs);
  }

  @Get()
  @Roles(...PERSONAL_RESEARCH_ROLES)
  @ApiOperation({ summary: 'Lista comparaciones guardadas propias' })
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.comparisons.findAll(user.id);
  }

  @Post()
  @Roles(...PERSONAL_RESEARCH_ROLES)
  @ApiOperation({ summary: 'Guarda una comparación propia' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateComparisonDto,
  ) {
    return this.comparisons.create(user.id, dto);
  }

  @Get(':id')
  @Roles(...PERSONAL_RESEARCH_ROLES)
  @ApiOperation({ summary: 'Abre una comparación propia' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.comparisons.findOne(user.id, id);
  }

  @Patch(':id')
  @Roles(...PERSONAL_RESEARCH_ROLES)
  @ApiOperation({ summary: 'Renombra una comparación propia' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateComparisonDto,
  ) {
    return this.comparisons.updateName(user.id, id, dto.name);
  }

  @Delete(':id')
  @Roles(...PERSONAL_RESEARCH_ROLES)
  @ApiOperation({ summary: 'Elimina una comparación propia' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.comparisons.remove(user.id, id);
  }
}

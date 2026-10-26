import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ROLES } from '../auth/constants';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CreateTimelineDto } from './dto/create-timeline.dto';
import { ResolveEvolutionDto } from './dto/resolve-evolution.dto';
import { UpdateTimelineDto } from './dto/update-timeline.dto';
import { ResearchTimelinesService } from './research-timelines.service';

const PERSONAL_RESEARCH_ROLES = [
  ROLES.ADMIN,
  ROLES.OPERADOR,
  ROLES.LECTOR,
  ROLES.REVISOR,
  ROLES.JURISPRUDENCIA,
  ROLES.DIGESTO,
] as const;

@ApiTags('research-evolution')
@Controller('research/evolution')
export class PublicEvolutionController {
  constructor(private readonly timelines: ResearchTimelinesService) {}

  @Post('resolve')
  @Public()
  @ApiOperation({
    summary: 'Resuelve cronología y relaciones verificadas de fallos públicos',
  })
  resolve(@Body() dto: ResolveEvolutionDto) {
    return this.timelines.resolvePublic(dto.slugs);
  }
}

@ApiTags('research-timelines')
@ApiBearerAuth()
@Roles(...PERSONAL_RESEARCH_ROLES)
@Controller('research/timelines')
export class ResearchTimelinesController {
  constructor(private readonly timelines: ResearchTimelinesService) {}

  @Get()
  @ApiOperation({ summary: 'Lista espacios de evolución propios' })
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.timelines.findAll(user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Guarda un espacio de evolución propio' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTimelineDto,
  ) {
    return this.timelines.create(user.id, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Abre un espacio propio y revalida sus fallos públicos',
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.timelines.findOne(user.id, id);
  }

  @Post(':id/export')
  @ApiOperation({
    summary:
      'Exporta un espacio propio al dossier de investigación verificable',
  })
  async exportBundle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) response: Response,
  ) {
    const bundle = await this.timelines.exportBundle(user.id, id);
    response.setHeader('Content-Type', 'application/zip');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${bundle.filename}"`,
    );
    response.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(bundle.stream);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualiza nombre, descripción o selección propia' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTimelineDto,
  ) {
    return this.timelines.update(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Elimina un espacio de evolución propio' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.timelines.remove(user.id, id);
  }
}

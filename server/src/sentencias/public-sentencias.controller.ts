import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { IaService } from '../ia/ia.service';
import { SentenciasService } from './sentencias.service';
import { SameExpedienteQueryDto } from './dto/same-expediente-query.dto';

@ApiTags('public-sentencias')
@Public()
@Controller('public/sentencias')
export class PublicSentenciasController {
  constructor(
    private readonly sentenciasService: SentenciasService,
    private readonly iaService: IaService,
  ) {}

  @Get('recientes')
  @ApiOperation({ summary: 'Últimos fallos incorporados y publicados' })
  recientes() {
    return this.sentenciasService.findRecentPublished(10);
  }

  @Get('mas-recientes')
  @ApiOperation({
    summary: 'Fallos publicados más recientes por fecha de decisión',
  })
  masRecientes() {
    return this.sentenciasService.findLatestByDecisionDate(10);
  }

  @Get(':slug/citas')
  @ApiOperation({
    summary: 'Obtiene citas confirmadas de una sentencia publica',
  })
  findCitasBySlug(@Param('slug') slug: string) {
    return this.sentenciasService.getPublicCitasBySlug(slug);
  }

  @Get(':slug/ficha')
  @ApiOperation({ summary: 'Obtiene la ficha publica de una sentencia' })
  findFichaBySlug(@Param('slug') slug: string) {
    return this.sentenciasService.getPublicFichaBySlug(slug);
  }

  @Get(':slug/documento')
  @ApiOperation({ summary: 'Obtiene los datos del visor documental publico' })
  findDocumentoBySlug(@Param('slug') slug: string) {
    return this.sentenciasService.getPublicDocumentoBySlug(slug);
  }

  @Get(':slug/relacionados')
  @ApiOperation({
    summary: 'Obtiene fallos publicos relacionados por IA o fallback textual',
  })
  async relacionados(@Param('slug') slug: string) {
    const identity: unknown =
      await this.sentenciasService.getPublicIdentity(slug);
    if (
      typeof identity !== 'object' ||
      identity === null ||
      !('id' in identity) ||
      typeof identity.id !== 'number'
    ) {
      throw new Error('Identidad pública de sentencia inválida');
    }
    return this.iaService.buscarSimilaresPublicos(identity.id, 5);
  }

  @Get(':slug/mismo-expediente')
  @ApiOperation({
    summary: 'Lista otras sentencias públicas del mismo expediente exacto',
  })
  mismoExpediente(
    @Param('slug') slug: string,
    @Query() query: SameExpedienteQueryDto,
  ) {
    return this.sentenciasService.findPublicSameExpediente(slug, query.limit);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Obtiene una sentencia pública por slug' })
  findBySlug(@Param('slug') slug: string) {
    return this.sentenciasService.getPublicBySlug(slug);
  }
}

import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { IaService } from '../ia/ia.service';
import { SentenciasService } from './sentencias.service';

@ApiTags('public-sentencias')
@Public()
@Controller('public/sentencias')
export class PublicSentenciasController {
  constructor(
    private readonly sentenciasService: SentenciasService,
    private readonly iaService: IaService,
  ) {}

  @Get(':slug/citas')
  @ApiOperation({ summary: 'Obtiene citas confirmadas de una sentencia publica' })
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
  @ApiOperation({ summary: 'Obtiene fallos publicos relacionados por IA o fallback textual' })
  async relacionados(@Param('slug') slug: string) {
    const sentencia = await this.sentenciasService.getPublicIdentity(slug);
    return this.iaService.buscarSimilaresPublicos(sentencia.id, 5);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Obtiene una sentencia pública por slug' })
  findBySlug(@Param('slug') slug: string) {
    return this.sentenciasService.getPublicBySlug(slug);
  }
}

import {
  Body,
  Controller,
  Get,
  NotImplementedException,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ROLES } from '../auth/constants';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { EstadisticasService } from './estadisticas.service';
import { EventosConsultaService } from './eventos-consulta.service';
import { TrackEventoDto } from './dto/track-evento.dto';
import { TrackShareLinkDto } from './dto/track-share-link.dto';
import { UsoStatsQueryDto } from './dto/uso-stats-query.dto';

@ApiTags('estadisticas')
@ApiBearerAuth()
@Roles(ROLES.ADMIN, ROLES.OPERADOR)
@Controller('estadisticas')
export class EstadisticasController {
  constructor(
    private readonly estadisticasService: EstadisticasService,
    private readonly eventosConsultaService: EventosConsultaService,
  ) {}

  @Get('resumen-general')
  @ApiOperation({ summary: 'Resumen general de contenido' })
  resumenGeneral() {
    return this.estadisticasService.resumenGeneral();
  }

  @Get('resumen')
  @ApiOperation({ summary: 'Alias corto de resumen general' })
  resumen() {
    return this.estadisticasService.resumenGeneral();
  }

  @Get('por-anio')
  @ApiOperation({ summary: 'Contenido agrupado por año' })
  porAnio() {
    return this.estadisticasService.porAnio();
  }

  @Get('por-mes')
  @ApiOperation({ summary: 'Contenido agrupado por mes de carga' })
  porMes() {
    return this.estadisticasService.porMes();
  }

  @Get('anual')
  @ApiOperation({ summary: 'Informe anual de carga jurisprudencial' })
  anual(@Query('anio') anio?: string) {
    return this.estadisticasService.anual(
      anio ? Number(anio) : new Date().getFullYear(),
    );
  }

  @Get('anual/exportar')
  @ApiOperation({ summary: 'Exporta el informe anual en PDF o DOCX' })
  async exportarAnual(
    @Query('anio') anio: string | undefined,
    @Query('formato') formato: 'pdf' | 'docx' = 'pdf',
    @Res() response: Response,
  ) {
    const exportResult = await this.estadisticasService.exportarAnual(
      anio ? Number(anio) : new Date().getFullYear(),
      formato,
    );

    if (exportResult.notImplemented) {
      throw new NotImplementedException(
        'La exportación DOCX queda documentada para una siguiente etapa. Use formato=pdf.',
      );
    }

    response.setHeader('Content-Type', exportResult.contentType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${exportResult.filename}"`,
    );

    return response.send(exportResult.buffer);
  }

  @Get('por-sala')
  @ApiOperation({ summary: 'Cantidad de sentencias por sala' })
  porSala() {
    return this.estadisticasService.porSala();
  }

  @Get('por-tipo-fallo')
  @ApiOperation({ summary: 'Cantidad de sentencias por tipo de fallo' })
  porTipoFallo() {
    return this.estadisticasService.porTipoFallo();
  }

  @Get('por-tribunal-origen')
  @ApiOperation({ summary: 'Cantidad de sentencias por tribunal de origen' })
  porTribunalOrigen() {
    return this.estadisticasService.porTribunalOrigen();
  }

  @Get('por-tema')
  @ApiOperation({ summary: 'Temas mas frecuentes' })
  porTema() {
    return this.estadisticasService.porTema();
  }

  @Get('calidad-datos')
  @ApiOperation({ summary: 'Indicadores de calidad documental' })
  calidadDatos() {
    return this.estadisticasService.calidadDatos();
  }

  @Get('calidad')
  @ApiOperation({ summary: 'Alias corto de calidad documental' })
  calidad() {
    return this.estadisticasService.calidadDatos();
  }

  @Get('publicacion')
  @ApiOperation({
    summary: 'Indicadores de publicación y sentencias destacadas',
  })
  publicacion() {
    return this.estadisticasService.publicacion();
  }

  @Get('uso/busquedas')
  @ApiOperation({ summary: 'Uso del sistema sobre búsquedas' })
  usoBusquedas(@Query() query: UsoStatsQueryDto) {
    return this.estadisticasService.usoBusquedas(query);
  }

  @Get('uso/resumen')
  @ApiOperation({ summary: 'Resumen avanzado de uso del sistema' })
  usoResumen(@Query() query: UsoStatsQueryDto) {
    return this.estadisticasService.usoResumen(query);
  }

  @Get('uso/busquedas-populares')
  @ApiOperation({ summary: 'Consultas mas frecuentes' })
  busquedasPopulares(@Query() query: UsoStatsQueryDto) {
    return this.estadisticasService.busquedasPopulares(query);
  }

  @Get('uso/busquedas-sin-resultados')
  @ApiOperation({ summary: 'Consultas frecuentes sin resultados' })
  busquedasSinResultados(@Query() query: UsoStatsQueryDto) {
    return this.estadisticasService.busquedasSinResultados(query);
  }

  @Get('uso/filtros-mas-usados')
  @ApiOperation({ summary: 'Filtros más utilizados en las búsquedas' })
  filtrosMasUsados(@Query() query: UsoStatsQueryDto) {
    return this.estadisticasService.filtrosMasUsados(query);
  }

  @Get('uso/sugerencias-clicks')
  @ApiOperation({ summary: 'Sugerencias mas clickeadas' })
  sugerenciasClicks(@Query() query: UsoStatsQueryDto) {
    return this.estadisticasService.sugerenciasClicks(query);
  }

  @Get('uso/documentos-mas-consultados')
  @ApiOperation({ summary: 'Documentos mas consultados en el visor' })
  documentosMasConsultados(@Query() query: UsoStatsQueryDto) {
    return this.estadisticasService.documentosMasConsultados(query);
  }

  @Get('uso/documentos-mas-descargados')
  @ApiOperation({ summary: 'Documentos mas descargados' })
  documentosMasDescargados(@Query() query: UsoStatsQueryDto) {
    return this.estadisticasService.documentosMasDescargados(query);
  }

  @Get('uso/actividad-por-dia')
  @ApiOperation({ summary: 'Actividad agregada por dia' })
  actividadPorDia(@Query() query: UsoStatsQueryDto) {
    return this.estadisticasService.actividadPorDia(query);
  }

  @Get('uso/sentencias-mas-vistas')
  @ApiOperation({ summary: 'Sentencias mas vistas' })
  sentenciasMasVistas(@Query() query: UsoStatsQueryDto) {
    return this.estadisticasService.sentenciasMasVistas(query);
  }

  @Get('uso/descargas-pdf')
  @ApiOperation({ summary: 'Descargas de PDF agrupadas por sentencia' })
  descargasPdf(@Query() query: UsoStatsQueryDto) {
    return this.estadisticasService.descargasPdf(query);
  }

  @Get('uso/descargas')
  @ApiOperation({ summary: 'Alias corto de descargas PDF' })
  descargas(@Query() query: UsoStatsQueryDto) {
    return this.estadisticasService.descargasPdf(query);
  }

  @Get('uso/favoritos')
  @ApiOperation({ summary: 'Eventos de favoritos' })
  favoritos(@Query() query: UsoStatsQueryDto) {
    return this.estadisticasService.favoritos(query);
  }

  @Get('uso/compartidos')
  @ApiOperation({ summary: 'Eventos de enlaces compartidos' })
  compartidos(@Query() query: UsoStatsQueryDto) {
    return this.estadisticasService.compartidos(query);
  }

  @Post('eventos')
  @ApiOperation({
    summary: 'Registra un evento autenticado del frontend interno',
  })
  evento(@Body() body: TrackEventoDto, @CurrentUser() user: AuthenticatedUser) {
    this.eventosConsultaService.trackSafe({
      tipoEvento: body.tipoEvento,
      usuarioId: user.id,
      sentenciaId: body.sentenciaId,
      metadata: body.metadata,
    });

    return { data: { tracked: true } };
  }

  @Public()
  @Post('eventos/share-link')
  @ApiOperation({ summary: 'Registra un evento de enlace compartido' })
  shareLink(
    @Body() body: TrackShareLinkDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    this.eventosConsultaService.trackSafe({
      tipoEvento: 'share_link',
      usuarioId: user?.id,
      sentenciaId: body.sentenciaId,
      metadata: { source: user ? 'internal' : 'public' },
    });

    return { data: { tracked: true } };
  }
}

@ApiTags('public-estadisticas')
@Public()
@Controller('public')
export class PublicEventosController {
  constructor(
    private readonly eventosConsultaService: EventosConsultaService,
  ) {}

  @Post('eventos')
  @ApiOperation({ summary: 'Registra un evento público del frontend' })
  eventoPublico(@Body() body: TrackEventoDto) {
    this.eventosConsultaService.trackSafe({
      tipoEvento: body.tipoEvento,
      sentenciaId: body.sentenciaId,
      metadata: body.metadata,
    });

    return { data: { tracked: true } };
  }
}

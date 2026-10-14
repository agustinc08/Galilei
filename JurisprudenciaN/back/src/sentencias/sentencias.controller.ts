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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ROLES } from '../auth/constants';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { IaService } from '../ia/ia.service';
import { CreateSentenciaDto } from './dto/create-sentencia.dto';
import { CargaRapidaSentenciaDto } from './dto/carga-rapida-sentencia.dto';
import { CrearSentenciaCompletaDto } from './dto/crear-sentencia-completa.dto';
import { CrearSumariosLoteDto } from './dto/crear-sumarios-lote.dto';
import { ExportarFichaQueryDto } from './dto/exportar-ficha-query.dto';
import { QuerySentenciasDto } from './dto/query-sentencias.dto';
import { UpdateResenaDto } from './dto/update-resena.dto';
import { UpdateResumenDto } from './dto/update-resumen.dto';
import { UpdateSentenciaDto } from './dto/update-sentencia.dto';
import { SentenciasService } from './sentencias.service';

@ApiTags('sentencias')
@ApiBearerAuth()
@Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.JURISPRUDENCIA)
@Controller('sentencias')
export class SentenciasController {
  constructor(
    private readonly sentenciasService: SentenciasService,
    private readonly iaService: IaService,
  ) {}

  @Get('buscar')
  @ApiOperation({ summary: 'Búsqueda simple de sentencias' })
  buscar(@Query('query') query: string) {
    return this.sentenciasService.buscar(query);
  }

  @Get('destacadas')
  @ApiOperation({ summary: 'Lista sentencias destacadas' })
  destacadas() {
    return this.sentenciasService.getDestacadas();
  }

  @Get('revision/cola-publicacion')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.JURISPRUDENCIA)
  @ApiOperation({
    summary:
      'Lista documentos civiles que requieren revisión antes de publicar',
  })
  getPublicationReviewQueue() {
    return this.sentenciasService.getPublicationReviewQueue();
  }

  @Get()
  @ApiOperation({ summary: 'Lista sentencias con filtros y paginación' })
  findAll(@Query() query: QuerySentenciasDto) {
    return this.sentenciasService.findAll(query);
  }

  @Get('por-numero/:numeroSentencia')
  @ApiOperation({ summary: 'Busca una sentencia por número para carga rápida' })
  findByNumero(
    @Param('numeroSentencia') numeroSentencia: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sentenciasService.findByNumero(numeroSentencia, user.id);
  }

  @Post('crear-completa')
  @ApiOperation({
    summary: 'Crea una sentencia con sus sumarios en una transaccion',
  })
  crearCompleta(
    @Body() dto: CrearSentenciaCompletaDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const safeDto = {
      ...dto,
      sentencia: {
        ...dto.sentencia,
        publicado: false,
        activo: true,
        estadoCarga: 'BORRADOR',
      },
      sumarios: dto.sumarios?.map((sumario) => ({
        ...sumario,
        publicado: false,
        activo: true,
      })),
      opcionesPublicacion: {
        ...dto.opcionesPublicacion,
        publicarSentencia: false,
        publicarSumarios: false,
        publicarResena: false,
        estadoCarga: 'BORRADOR',
      },
    };
    return this.sentenciasService.crearCompleta(safeDto, user.id);
  }

  @Post('carga-rapida')
  @ApiOperation({
    summary: 'Crea o actualiza sentencia y agrega un sumario en un paso',
  })
  cargaRapida(
    @Body() dto: CargaRapidaSentenciaDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const safeDto = {
      ...dto,
      sentencia: {
        ...dto.sentencia,
        publicado: false,
        activo: true,
        estadoCarga: 'BORRADOR',
      },
      sumario: { ...dto.sumario, publicado: false, activo: true },
    };
    return this.sentenciasService.cargaRapida(safeDto, user.id);
  }

  @Post(':id/sumarios/lote')
  @ApiOperation({ summary: 'Agrega varios sumarios a una sentencia existente' })
  agregarSumariosLote(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CrearSumariosLoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sentenciasService.agregarSumariosLote(id, dto, user.id);
  }

  @Get(':id/completa')
  @ApiOperation({ summary: 'Obtiene sentencia con sumarios activos y PDFs' })
  findCompleta(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sentenciasService.findCompleta(id, user.id);
  }

  @Get(':id/resumen')
  @ApiOperation({ summary: 'Obtiene el resumen del fallo' })
  getResumen(@Param('id', ParseIntPipe) id: number) {
    return this.sentenciasService.getResumen(id);
  }

  @Patch(':id/resumen')
  @ApiOperation({ summary: 'Actualiza el resumen del fallo' })
  updateResumen(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateResumenDto,
  ) {
    return this.sentenciasService.updateResumen(id, dto);
  }

  @Patch(':id/resena')
  @ApiOperation({ summary: 'Actualiza la reseña de la sentencia' })
  updateResena(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateResenaDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sentenciasService.updateResena(id, dto, user.id);
  }

  @Get(':id/resena')
  @ApiOperation({ summary: 'Obtiene la reseña editorial de la sentencia' })
  getResena(@Param('id', ParseIntPipe) id: number) {
    return this.sentenciasService.getResena(id);
  }

  @Patch(':id/resena/publicar')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR)
  @ApiOperation({ summary: 'Publica la reseña editorial' })
  publicarResena(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sentenciasService.setResenaPublicada(id, true, user.id);
  }

  @Patch(':id/resena/despublicar')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR)
  @ApiOperation({ summary: 'Despublica la reseña editorial' })
  despublicarResena(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sentenciasService.setResenaPublicada(id, false, user.id);
  }

  @Post(':id/ia/resena-sugerida')
  @ApiOperation({ summary: 'Genera una reseña sugerida con RAG local' })
  generarResenaSugerida(@Param('id', ParseIntPipe) id: number) {
    return this.iaService.generarResenaSugerida(id);
  }

  @Post(':id/resena/generar-ia')
  @ApiOperation({
    summary: 'Genera un borrador de reseña con Ollama y RAG local',
  })
  generarResenaIa(@Param('id', ParseIntPipe) id: number) {
    return this.iaService.generarResenaSugerida(id);
  }

  @Get(':id/similares')
  @ApiOperation({
    summary: 'Obtiene fallos similares por embeddings o fallback textual',
  })
  similares(
    @Param('id', ParseIntPipe) id: number,
    @Query('limit') limit = '10',
  ) {
    return this.iaService.buscarSimilares(id, Number(limit) || 10);
  }

  @Get(':id/cita')
  @ApiOperation({ summary: 'Obtiene la cita util de la sentencia' })
  getCita(@Param('id', ParseIntPipe) id: number) {
    return this.sentenciasService.getCita(id);
  }

  @Post(':id/generar-cita')
  @ApiOperation({ summary: 'Genera y guarda una cita util de la sentencia' })
  generarCita(@Param('id', ParseIntPipe) id: number) {
    return this.sentenciasService.generarCita(id);
  }

  @Get(':id/ficha')
  @ApiOperation({ summary: 'Obtiene la ficha completa de la sentencia' })
  getFicha(@Param('id', ParseIntPipe) id: number) {
    return this.sentenciasService.getFicha(id);
  }

  @Get(':id/documento')
  @ApiOperation({
    summary: 'Obtiene los datos del visor documental de la sentencia',
  })
  getDocumento(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sentenciasService.getDocumento(id, user.id);
  }

  @Get(':id/timeline')
  @ApiOperation({ summary: 'Obtiene el historial de acciones de la sentencia' })
  timeline(
    @Param('id', ParseIntPipe) id: number,
    @Query('order') order: 'asc' | 'desc' = 'desc',
  ) {
    return this.sentenciasService.getTimeline(id, order);
  }

  @Patch(':id/anonimizar')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR)
  @ApiOperation({ summary: 'Anonimiza actor y demandado para vista pública' })
  anonimizar(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sentenciasService.anonimizar(id, user.id);
  }

  @Patch(':id/desanonimizar')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR)
  @ApiOperation({
    summary: 'Revierte el estado de anonimizado y restaura nombres originales',
  })
  desanonimizar(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sentenciasService.desanonimizar(id, user.id);
  }

  @Get(':id/exportar-ficha')
  @ApiOperation({ summary: 'Exporta ficha en json, txt u html' })
  async exportarFicha(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ExportarFichaQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const formato = query.formato ?? 'json';
    const data = await this.sentenciasService.exportFicha(id, formato);

    if (formato === 'json') {
      return data;
    }

    const ext = formato === 'html' ? 'html' : 'txt';
    response.setHeader(
      'Content-Type',
      formato === 'html'
        ? 'text/html; charset=utf-8'
        : 'text/plain; charset=utf-8',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="sentencia-${id}-ficha.${ext}"`,
    );

    return data;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtiene una sentencia por id' })
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sentenciasService.findOne(id, user.id);
  }

  @Get(':id/posibles-duplicados')
  @ApiOperation({
    summary: 'Busca decisiones que podrían ser la misma sentencia',
  })
  findPotentialDuplicates(@Param('id', ParseIntPipe) id: number) {
    return this.sentenciasService.findPotentialDuplicates(id);
  }

  @Post()
  @ApiOperation({ summary: 'Crea una sentencia' })
  create(
    @Body() createSentenciaDto: CreateSentenciaDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const safeDto = {
      ...createSentenciaDto,
      publicado: false,
      activo: true,
      estadoCarga: 'BORRADOR',
    };
    return this.sentenciasService.create(safeDto, user.id);
  }

  @Post(':id/generar-slug')
  @ApiOperation({ summary: 'Genera slug público para sentencia publicada' })
  generarSlug(@Param('id', ParseIntPipe) id: number) {
    return this.sentenciasService.generarSlug(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualiza una sentencia' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateSentenciaDto: UpdateSentenciaDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const safeDto = { ...updateSentenciaDto };
    delete safeDto.publicado;
    delete safeDto.activo;
    delete safeDto.estadoCarga;
    return this.sentenciasService.update(id, safeDto, user.id);
  }

  @Patch(':id/publicar')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.JURISPRUDENCIA)
  @ApiOperation({ summary: 'Publica una sentencia' })
  publicar(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sentenciasService.setPublicado(id, true, user.id);
  }

  @Patch(':id/despublicar')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.JURISPRUDENCIA)
  @ApiOperation({ summary: 'Despublica una sentencia' })
  despublicar(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sentenciasService.setPublicado(id, false, user.id);
  }

  @Patch(':id/archivar')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.JURISPRUDENCIA)
  @ApiOperation({ summary: 'Archiva una sentencia sin eliminar su historial' })
  archivar(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sentenciasService.archive(id, user.id);
  }

  @Patch(':id/destacar')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR)
  @ApiOperation({ summary: 'Marca una sentencia como destacada' })
  destacar(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sentenciasService.setDestacada(id, true, user.id);
  }

  @Patch(':id/quitar-destacada')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR)
  @ApiOperation({ summary: 'Quita la marca destacada de una sentencia' })
  quitarDestacada(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sentenciasService.setDestacada(id, false, user.id);
  }

  @Delete(':id')
  @Roles(ROLES.ADMIN)
  @ApiOperation({ summary: 'Desactiva una sentencia' })
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sentenciasService.archive(id, user.id);
  }
}

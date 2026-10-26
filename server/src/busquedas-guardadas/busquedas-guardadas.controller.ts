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
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { BusquedasGuardadasService } from './busquedas-guardadas.service';
import { CreateBusquedaGuardadaDto } from './dto/create-busqueda-guardada.dto';
import { UpdateBusquedaGuardadaDto } from './dto/update-busqueda-guardada.dto';
import { SavedSearchNoveltiesQueryDto } from './dto/saved-search-novelties-query.dto';
import { MarkNoveltiesViewedDto } from './dto/mark-novelties-viewed.dto';

@ApiTags('busquedas-guardadas')
@ApiBearerAuth()
@Roles(ROLES.ADMIN, ROLES.OPERADOR)
@Controller('busquedas-guardadas')
export class BusquedasGuardadasController {
  constructor(
    private readonly busquedasGuardadasService: BusquedasGuardadasService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lista las busquedas guardadas del usuario' })
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.busquedasGuardadasService.findAll(user.id);
  }

  @Get(':id/novedades')
  @ApiOperation({
    summary: 'Consulta los fallos publicados desde la última revisión',
  })
  novelties(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: SavedSearchNoveltiesQueryDto,
  ) {
    return this.busquedasGuardadasService.findNovelties(user.id, id, query);
  }

  @Post(':id/novedades/vistas')
  @ApiOperation({ summary: 'Marca como revisadas las novedades mostradas' })
  markNoveltiesViewed(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MarkNoveltiesViewedDto,
  ) {
    return this.busquedasGuardadasService.markNoveltiesViewed(user.id, id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtiene una búsqueda guardada del usuario' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.busquedasGuardadasService.findOne(user.id, id);
  }

  @Post()
  @ApiOperation({ summary: 'Guarda una nueva búsqueda administrativa' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBusquedaGuardadaDto,
  ) {
    return this.busquedasGuardadasService.create(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualiza una búsqueda guardada del usuario' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBusquedaGuardadaDto,
  ) {
    return this.busquedasGuardadasService.update(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Elimina una búsqueda guardada del usuario' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.busquedasGuardadasService.remove(user.id, id);
  }
}

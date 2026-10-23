import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLES } from '../auth/constants';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { BusquedasGuardadasService } from './busquedas-guardadas.service';
import { CreateBusquedaGuardadaDto } from './dto/create-busqueda-guardada.dto';
import { UpdateBusquedaGuardadaDto } from './dto/update-busqueda-guardada.dto';

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

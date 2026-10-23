import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLES } from '../auth/constants';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CatalogosService } from './catalogos.service';
import { CreateCatalogoItemDto } from './dto/create-catalogo-item.dto';
import { UpdateCatalogoItemDto } from './dto/update-catalogo-item.dto';

@ApiTags('catalogos')
@Controller('catalogos')
export class CatalogosController {
  constructor(private readonly catalogosService: CatalogosService) {}

  @Get('salas')
  @Public()
  @ApiOperation({ summary: 'Lista salas de catalogo' })
  getSalas(@Query('includeInactive') includeInactive?: string) {
    return this.catalogosService.getSalas(includeInactive === 'true');
  }

  @Get('tipos-fallo')
  @Public()
  @ApiOperation({ summary: 'Lista tipos de fallo de catalogo' })
  getTiposFallo(@Query('includeInactive') includeInactive?: string) {
    return this.catalogosService.getTiposFallo(includeInactive === 'true');
  }

  @Get('tribunales-origen')
  @Public()
  @ApiOperation({ summary: 'Lista tribunales de origen de catalogo' })
  getTribunales(@Query('includeInactive') includeInactive?: string) {
    return this.catalogosService.getTribunalesOrigen(includeInactive === 'true');
  }

  @Post('salas')
  @ApiBearerAuth()
  @Roles(ROLES.ADMIN, ROLES.OPERADOR)
  @ApiOperation({ summary: 'Crea una sala de catalogo' })
  createSala(@Body() dto: CreateCatalogoItemDto) {
    return this.catalogosService.createSala(dto);
  }

  @Patch('salas/:id')
  @ApiBearerAuth()
  @Roles(ROLES.ADMIN, ROLES.OPERADOR)
  @ApiOperation({ summary: 'Actualiza una sala de catalogo' })
  updateSala(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCatalogoItemDto) {
    return this.catalogosService.updateSala(id, dto);
  }

  @Post('tipos-fallo')
  @ApiBearerAuth()
  @Roles(ROLES.ADMIN, ROLES.OPERADOR)
  @ApiOperation({ summary: 'Crea un tipo de fallo de catalogo' })
  createTipo(@Body() dto: CreateCatalogoItemDto) {
    return this.catalogosService.createTipoFallo(dto);
  }

  @Patch('tipos-fallo/:id')
  @ApiBearerAuth()
  @Roles(ROLES.ADMIN, ROLES.OPERADOR)
  @ApiOperation({ summary: 'Actualiza un tipo de fallo de catalogo' })
  updateTipo(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCatalogoItemDto) {
    return this.catalogosService.updateTipoFallo(id, dto);
  }

  @Post('tribunales-origen')
  @ApiBearerAuth()
  @Roles(ROLES.ADMIN, ROLES.OPERADOR)
  @ApiOperation({ summary: 'Crea un tribunal de origen de catalogo' })
  createTribunal(@Body() dto: CreateCatalogoItemDto) {
    return this.catalogosService.createTribunalOrigen(dto);
  }

  @Patch('tribunales-origen/:id')
  @ApiBearerAuth()
  @Roles(ROLES.ADMIN, ROLES.OPERADOR)
  @ApiOperation({ summary: 'Actualiza un tribunal de origen de catalogo' })
  updateTribunal(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCatalogoItemDto,
  ) {
    return this.catalogosService.updateTribunalOrigen(id, dto);
  }
}

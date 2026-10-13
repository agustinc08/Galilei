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
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateEquivalenciaNormativaDto } from './dto/create-equivalencia-normativa.dto';
import { CreateNormaArticuloDto } from './dto/create-norma-articulo.dto';
import { QueryNormasDto } from './dto/query-normas.dto';
import { UpdateNormaArticuloDto } from './dto/update-norma-articulo.dto';
import { NormasService } from './normas.service';

@ApiTags('normas')
@ApiBearerAuth()
@Roles(ROLES.ADMIN, ROLES.OPERADOR)
@Controller()
export class NormasController {
  constructor(private readonly service: NormasService) {}

  @Get('normas')
  @ApiOperation({ summary: 'Lista normas y articulos' })
  findAll(@Query() query: QueryNormasDto) {
    return this.service.findAll(query);
  }

  @Get('normas/:id')
  @ApiOperation({ summary: 'Obtiene una norma o articulo' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post('normas')
  @ApiOperation({ summary: 'Crea una norma o articulo' })
  create(@Body() dto: CreateNormaArticuloDto) {
    return this.service.create(dto);
  }

  @Patch('normas/:id')
  @ApiOperation({ summary: 'Actualiza una norma o articulo' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateNormaArticuloDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete('normas/:id')
  @ApiOperation({ summary: 'Desactiva una norma o articulo' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  @Get('normas/:id/equivalencias')
  @ApiOperation({ summary: 'Lista equivalencias normativas' })
  findEquivalencias(@Param('id', ParseIntPipe) id: number) {
    return this.service.findEquivalencias(id);
  }

  @Post('normas/:id/equivalencias')
  @ApiOperation({ summary: 'Crea una equivalencia normativa' })
  createEquivalencia(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateEquivalenciaNormativaDto,
  ) {
    return this.service.createEquivalencia(id, dto);
  }

  @Delete('equivalencias-normativas/:id')
  @ApiOperation({ summary: 'Elimina una equivalencia normativa' })
  removeEquivalencia(@Param('id', ParseIntPipe) id: number) {
    return this.service.removeEquivalencia(id);
  }
}

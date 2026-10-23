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
import { CreateSumarioDto } from './dto/create-sumario.dto';
import { QuerySumariosDto } from './dto/query-sumarios.dto';
import { UpdateSumarioDto } from './dto/update-sumario.dto';
import { SumariosService } from './sumarios.service';

@ApiTags('sumarios')
@ApiBearerAuth()
@Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.JURISPRUDENCIA)
@Controller('sumarios')
export class SumariosController {
  constructor(private readonly sumariosService: SumariosService) {}

  @Get('buscar')
  @ApiOperation({ summary: 'Búsqueda simple de sumarios' })
  buscar(@Query('query') query: string) {
    return this.sumariosService.buscar(query);
  }

  @Get()
  @ApiOperation({ summary: 'Lista sumarios con filtros y paginación' })
  findAll(@Query() query: QuerySumariosDto) {
    return this.sumariosService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtiene un sumario por id' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.sumariosService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Crea un sumario' })
  create(
    @Body() createSumarioDto: CreateSumarioDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sumariosService.create(createSumarioDto, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualiza un sumario' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateSumarioDto: UpdateSumarioDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sumariosService.update(id, updateSumarioDto, user.id);
  }

  @Patch(':id/publicar')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR)
  @ApiOperation({ summary: 'Publica un sumario' })
  publicar(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sumariosService.setPublicado(id, true, user.id);
  }

  @Patch(':id/despublicar')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR)
  @ApiOperation({ summary: 'Despublica un sumario' })
  despublicar(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sumariosService.setPublicado(id, false, user.id);
  }

  @Delete(':id')
  @Roles(ROLES.ADMIN)
  @ApiOperation({ summary: 'Desactiva un sumario' })
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sumariosService.remove(id, user.id);
  }
}

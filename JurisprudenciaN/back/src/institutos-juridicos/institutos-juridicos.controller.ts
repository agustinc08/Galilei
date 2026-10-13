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
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateInstitutoJuridicoDto } from './dto/create-instituto-juridico.dto';
import { CreateSinonimoJuridicoDto } from './dto/create-sinonimo-juridico.dto';
import { UpdateInstitutoJuridicoDto } from './dto/update-instituto-juridico.dto';
import { UpdateSinonimoJuridicoDto } from './dto/update-sinonimo-juridico.dto';
import { InstitutosJuridicosService } from './institutos-juridicos.service';

@ApiTags('institutos-juridicos')
@ApiBearerAuth()
@Roles(ROLES.ADMIN, ROLES.OPERADOR)
@Controller()
export class InstitutosJuridicosController {
  constructor(private readonly service: InstitutosJuridicosService) {}

  @Get('institutos-juridicos')
  @ApiOperation({ summary: 'Lista institutos jurídicos' })
  findAll() {
    return this.service.findAll();
  }

  @Get('institutos-juridicos/:id')
  @ApiOperation({ summary: 'Obtiene un instituto jurídico' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post('institutos-juridicos')
  @ApiOperation({ summary: 'Crea un instituto jurídico' })
  create(@Body() dto: CreateInstitutoJuridicoDto) {
    return this.service.create(dto);
  }

  @Patch('institutos-juridicos/:id')
  @ApiOperation({ summary: 'Actualiza un instituto jurídico' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateInstitutoJuridicoDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete('institutos-juridicos/:id')
  @ApiOperation({ summary: 'Desactiva un instituto jurídico' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  @Get('institutos-juridicos/:id/sinonimos')
  @ApiOperation({ summary: 'Lista sinónimos jurídicos de un instituto' })
  findSinonimos(@Param('id', ParseIntPipe) id: number) {
    return this.service.findSinonimos(id);
  }

  @Post('institutos-juridicos/:id/sinonimos')
  @ApiOperation({ summary: 'Crea un sinónimo jurídico' })
  createSinonimo(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateSinonimoJuridicoDto,
  ) {
    return this.service.createSinonimo(id, dto);
  }

  @Patch('sinonimos-juridicos/:id')
  @ApiOperation({ summary: 'Actualiza un sinónimo jurídico' })
  updateSinonimo(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSinonimoJuridicoDto,
  ) {
    return this.service.updateSinonimo(id, dto);
  }

  @Delete('sinonimos-juridicos/:id')
  @ApiOperation({ summary: 'Desactiva un sinónimo jurídico' })
  removeSinonimo(@Param('id', ParseIntPipe) id: number) {
    return this.service.removeSinonimo(id);
  }
}

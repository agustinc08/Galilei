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
import { CreateCitaFalloDto } from './dto/create-cita-fallo.dto';
import { UpdateCitaFalloDto } from './dto/update-cita-fallo.dto';
import { CitasFalloService } from './citas-fallo.service';

@ApiTags('citas-fallo')
@ApiBearerAuth()
@Roles(ROLES.ADMIN, ROLES.OPERADOR)
@Controller()
export class CitasFalloController {
  constructor(private readonly citasFalloService: CitasFalloService) {}

  @Get('sentencias/:id/citas')
  @ApiOperation({ summary: 'Lista citas de una sentencia' })
  findBySentencia(@Param('id', ParseIntPipe) sentenciaId: number) {
    return this.citasFalloService.findBySentencia(sentenciaId);
  }

  @Post('sentencias/:id/citas')
  @ApiOperation({ summary: 'Crea una cita manual para una sentencia' })
  create(
    @Param('id', ParseIntPipe) sentenciaId: number,
    @Body() dto: CreateCitaFalloDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.citasFalloService.create(sentenciaId, dto, user.id);
  }

  @Post('sentencias/:id/citas/detectar')
  @ApiOperation({ summary: 'Detecta automaticamente citas en una sentencia' })
  detectar(
    @Param('id', ParseIntPipe) sentenciaId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.citasFalloService.detectar(sentenciaId, user.id);
  }

  @Patch('citas-fallo/:id')
  @ApiOperation({ summary: 'Edita una cita del fallo' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCitaFalloDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.citasFalloService.update(id, dto, user.id);
  }

  @Delete('citas-fallo/:id')
  @ApiOperation({ summary: 'Elimina una cita del fallo' })
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.citasFalloService.remove(id, user.id);
  }
}

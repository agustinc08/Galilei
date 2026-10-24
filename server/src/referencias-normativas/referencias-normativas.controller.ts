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
import { CreateReferenciaNormativaDto } from './dto/create-referencia-normativa.dto';
import { UpdateReferenciaNormativaDto } from './dto/update-referencia-normativa.dto';
import { ReferenciasNormativasService } from './referencias-normativas.service';

@ApiTags('referencias-normativas')
@ApiBearerAuth()
@Roles(ROLES.ADMIN, ROLES.OPERADOR)
@Controller()
export class ReferenciasNormativasController {
  constructor(
    private readonly referenciasNormativasService: ReferenciasNormativasService,
  ) {}

  @Get('sentencias/:id/referencias-normativas')
  @ApiOperation({ summary: 'Lista referencias normativas por sentencia' })
  findBySentencia(@Param('id', ParseIntPipe) sentenciaId: number) {
    return this.referenciasNormativasService.findBySentencia(sentenciaId);
  }

  @Post('sentencias/:id/referencias-normativas')
  @ApiOperation({ summary: 'Crea referencia normativa' })
  create(
    @Param('id', ParseIntPipe) sentenciaId: number,
    @Body() dto: CreateReferenciaNormativaDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.referenciasNormativasService.create(sentenciaId, dto, user.id);
  }

  @Post('sentencias/:id/referencias-normativas/detectar')
  @ApiOperation({
    summary: 'Detecta normas y artículos en PDF, sumarios y reseña',
  })
  detectar(
    @Param('id', ParseIntPipe) sentenciaId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.referenciasNormativasService.detectar(sentenciaId, user.id);
  }

  @Patch('referencias-normativas/:id')
  @ApiOperation({ summary: 'Actualiza referencia normativa' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReferenciaNormativaDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.referenciasNormativasService.update(id, dto, user.id);
  }

  @Delete('referencias-normativas/:id')
  @ApiOperation({ summary: 'Elimina referencia normativa' })
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.referenciasNormativasService.remove(id, user.id);
  }
}

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
import { CreateReferenciaDoctrinariaDto } from './dto/create-referencia-doctrinaria.dto';
import { UpdateReferenciaDoctrinariaDto } from './dto/update-referencia-doctrinaria.dto';
import { ReferenciasDoctrinariasService } from './referencias-doctrinarias.service';

@ApiTags('referencias-doctrinarias')
@ApiBearerAuth()
@Roles(ROLES.ADMIN, ROLES.OPERADOR)
@Controller()
export class ReferenciasDoctrinariasController {
  constructor(
    private readonly referenciasDoctrinariasService: ReferenciasDoctrinariasService,
  ) {}

  @Get('sentencias/:id/referencias-doctrinarias')
  @ApiOperation({ summary: 'Lista referencias doctrinarias por sentencia' })
  findBySentencia(@Param('id', ParseIntPipe) sentenciaId: number) {
    return this.referenciasDoctrinariasService.findBySentencia(sentenciaId);
  }

  @Post('sentencias/:id/referencias-doctrinarias')
  @ApiOperation({ summary: 'Crea referencia doctrinaria' })
  create(
    @Param('id', ParseIntPipe) sentenciaId: number,
    @Body() dto: CreateReferenciaDoctrinariaDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.referenciasDoctrinariasService.create(sentenciaId, dto, user.id);
  }

  @Patch('referencias-doctrinarias/:id')
  @ApiOperation({ summary: 'Actualiza referencia doctrinaria' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReferenciaDoctrinariaDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.referenciasDoctrinariasService.update(id, dto, user.id);
  }

  @Delete('referencias-doctrinarias/:id')
  @ApiOperation({ summary: 'Elimina referencia doctrinaria' })
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.referenciasDoctrinariasService.remove(id, user.id);
  }
}

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
import { CreateReferenciaJurisprudencialDto } from './dto/create-referencia-jurisprudencial.dto';
import { UpdateReferenciaJurisprudencialDto } from './dto/update-referencia-jurisprudencial.dto';
import { ReferenciasJurisprudencialesService } from './referencias-jurisprudenciales.service';

@ApiTags('referencias-jurisprudenciales')
@ApiBearerAuth()
@Roles(ROLES.ADMIN, ROLES.OPERADOR)
@Controller()
export class ReferenciasJurisprudencialesController {
  constructor(
    private readonly referenciasJurisprudencialesService: ReferenciasJurisprudencialesService,
  ) {}

  @Get('sentencias/:id/referencias-jurisprudenciales')
  @ApiOperation({
    summary: 'Lista referencias jurisprudenciales por sentencia',
  })
  findBySentencia(@Param('id', ParseIntPipe) sentenciaId: number) {
    return this.referenciasJurisprudencialesService.findBySentencia(
      sentenciaId,
    );
  }

  @Post('sentencias/:id/referencias-jurisprudenciales')
  @ApiOperation({ summary: 'Crea referencia jurisprudencial' })
  create(
    @Param('id', ParseIntPipe) sentenciaId: number,
    @Body() dto: CreateReferenciaJurisprudencialDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.referenciasJurisprudencialesService.create(
      sentenciaId,
      dto,
      user.id,
    );
  }

  @Patch('referencias-jurisprudenciales/:id')
  @ApiOperation({ summary: 'Actualiza referencia jurisprudencial' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReferenciaJurisprudencialDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.referenciasJurisprudencialesService.update(id, dto, user.id);
  }

  @Delete('referencias-jurisprudenciales/:id')
  @ApiOperation({ summary: 'Elimina referencia jurisprudencial' })
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.referenciasJurisprudencialesService.remove(id, user.id);
  }
}

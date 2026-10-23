import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLES } from '../auth/constants';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { FavoritosService } from './favoritos.service';

@ApiTags('favoritos')
@ApiBearerAuth()
@Roles(ROLES.ADMIN, ROLES.OPERADOR)
@Controller('favoritos')
export class FavoritosController {
  constructor(private readonly favoritosService: FavoritosService) {}

  @Get()
  @ApiOperation({ summary: 'Lista favoritos del usuario autenticado' })
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.favoritosService.findAll(user.id);
  }

  @Post(':sentenciaId')
  @ApiOperation({ summary: 'Agrega una sentencia a favoritos' })
  add(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sentenciaId', ParseIntPipe) sentenciaId: number,
  ) {
    return this.favoritosService.add(user.id, sentenciaId);
  }

  @Delete(':sentenciaId')
  @ApiOperation({ summary: 'Quita una sentencia de favoritos' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sentenciaId', ParseIntPipe) sentenciaId: number,
  ) {
    return this.favoritosService.remove(user.id, sentenciaId);
  }
}

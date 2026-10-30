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
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';
import { UsuariosService } from './usuarios.service';

@ApiTags('usuarios')
@ApiBearerAuth()
@Roles(ROLES.ADMIN)
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuariosService: UsuariosService) {}

  @Get()
  @ApiOperation({ summary: 'Lista usuarios con rol' })
  findAll() {
    return this.usuariosService.findAll();
  }

  @Get(':id/auditoria')
  @ApiOperation({ summary: 'Lista auditoría básica de un usuario' })
  findAudit(@Param('id', ParseIntPipe) id: number) {
    return this.usuariosService.findAudit(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtiene un usuario por id' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.usuariosService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Crea un usuario y hashea password' })
  create(
    @Body() createUsuarioDto: CreateUsuarioDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.usuariosService.create(createUsuarioDto, actor.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualiza un usuario' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUsuarioDto: UpdateUsuarioDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.usuariosService.update(id, updateUsuarioDto, actor.id);
  }

  @Post(':id/reset-password')
  @ApiOperation({ summary: 'Resetea password de un usuario' })
  resetPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.usuariosService.resetPassword(id, dto, actor.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Desactiva un usuario' })
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.usuariosService.remove(id, actor.id);
  }
}

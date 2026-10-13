import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { AuthService } from './auth.service';
import { ROLES } from './constants';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import type { AuthenticatedUser } from './types/authenticated-user.type';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @Public()
  @ApiOperation({ summary: 'Inicia sesión y devuelve credenciales de acceso' })
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Get('me')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.LECTOR, ROLES.REVISOR, ROLES.JURISPRUDENCIA, ROLES.DIGESTO)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Devuelve el usuario autenticado' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user);
  }

  @Post('change-password')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.LECTOR, ROLES.REVISOR, ROLES.JURISPRUDENCIA, ROLES.DIGESTO)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cambia password del usuario autenticado' })
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.id, dto);
  }
}

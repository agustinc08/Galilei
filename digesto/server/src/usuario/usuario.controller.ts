// usuario.controller.ts
import { Controller, Post, Body, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { UsuarioService } from './usuario.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@Controller('users')
@ApiTags('Usuarios')
    export class UsuarioController {
        constructor(private userService: UsuarioService) { }
        @ApiOperation({ summary: 'Creacion de usuario en base, se pasa por body mail, password y rol(user o admin)' })
        @Post('register')
        async register(@Body('email') email: string, @Body('password') password: string, @Body('role') role: string, @Body('username') username: string) {
            return this.userService.createUser(email, password, role, username);
        }

    @Post('login')
    @ApiOperation({ summary: 'Logeo del usuario, nuevamente por body se pasa email y password' })
    async login(@Body('email') email: string, @Body('password') password: string) {
        try {
            const user = await this.userService.getUserByEmail(email);

            if (!user) {
                throw new NotFoundException('Usuario no encontrado');
            }

            const isPasswordValid = await this.userService.comparePasswords(password, user.password);
            if (!isPasswordValid) {
                throw new UnauthorizedException('Contraseña incorrecta');
            }

            return { success: true, email: user.email, role: user.role, username: user.username };
        } catch (error: any) {
            // Manejar errores y devolver una respuesta con success: false
            return { success: false, error: error.message };
        }
    }

}

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    ConfigModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const expiresIn = resolveJwtExpiresIn(
          configService.get<string>('JWT_EXPIRES_IN'),
        );
        const secret = configService.getOrThrow<string>('JWT_SECRET');
        if (
          configService.get<string>('NODE_ENV') === 'production' &&
          (secret.length < 32 || /change[-_ ]?me|example|secret/iu.test(secret))
        ) {
          throw new Error(
            'JWT_SECRET de producción debe tener al menos 32 caracteres y no puede ser un valor de ejemplo.',
          );
        }

        return {
          secret,
          signOptions: { expiresIn },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}

function resolveJwtExpiresIn(value?: string): JwtSignOptions['expiresIn'] {
  const configured = value?.trim() || '8h';
  if (!/^\d{1,6}(s|m|h|d)$/u.test(configured)) {
    throw new Error(
      'JWT_EXPIRES_IN debe usar un intervalo explícito, por ejemplo 8h.',
    );
  }
  return configured as JwtSignOptions['expiresIn'];
}

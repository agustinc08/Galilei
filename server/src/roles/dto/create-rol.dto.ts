import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateRolDto {
  @ApiProperty({ example: 'ADMIN' })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  nombre!: string;

  @ApiPropertyOptional({ example: 'Administradores del sistema' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  descripcion?: string;
}

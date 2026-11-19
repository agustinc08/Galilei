import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export const TIPOS_REPORTE_PROBLEMA = [
  'ERROR',
  'FUNCIONAMIENTO',
  'ACCESO',
  'CONTENIDO',
  'OTRO',
] as const;

export class CreateReporteProblemaDto {
  @ApiProperty({ enum: TIPOS_REPORTE_PROBLEMA })
  @IsIn(TIPOS_REPORTE_PROBLEMA)
  tipo!: (typeof TIPOS_REPORTE_PROBLEMA)[number];

  @ApiProperty({ maxLength: 4000 })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  descripcion!: string;

  @ApiProperty({ example: '/busqueda', maxLength: 500 })
  @IsString()
  @MaxLength(500)
  @Matches(/^\/(?!\/)[^?#\s]*$/u)
  ruta!: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @IsString()
  @MaxLength(1000)
  accion?: string;

  @ApiPropertyOptional({ maxLength: 80, pattern: '^[A-Za-z0-9._:-]+$' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9._:-]+$/u)
  errorId?: string;
}

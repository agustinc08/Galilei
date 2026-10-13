import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateSumarioDto {
  @ApiPropertyOptional({ example: 'SUM 1' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  numeroSumario?: string;

  @ApiPropertyOptional({ example: 'Responsabilidad civil' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  tema?: string;

  @ApiProperty({ example: 'Texto del sumario jurisprudencial.' })
  @IsString()
  @MinLength(1)
  texto!: string;

  @ApiPropertyOptional({ example: 'Palabras clave para búsqueda inicial' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  resumenBusqueda?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  publicado?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sentenciaId!: number;
}

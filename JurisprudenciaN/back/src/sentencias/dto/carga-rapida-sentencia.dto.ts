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
  ValidateNested,
} from 'class-validator';
import { CreateSentenciaDto } from './create-sentencia.dto';

class CargaRapidaSumarioDto {
  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id?: number;

  @ApiPropertyOptional({ example: 'SUM 1001' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  numeroSumario?: string;

  @ApiPropertyOptional({ example: 'Danio moral' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  tema?: string;

  @ApiProperty({ example: 'Texto completo del sumario.' })
  @IsString()
  @MinLength(1)
  texto!: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  publicado?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class CargaRapidaSentenciaDto {
  @ApiProperty({ type: CreateSentenciaDto })
  @ValidateNested()
  @Type(() => CreateSentenciaDto)
  sentencia!: CreateSentenciaDto;

  @ApiProperty({ type: CargaRapidaSumarioDto })
  @ValidateNested()
  @Type(() => CargaRapidaSumarioDto)
  sumario!: CargaRapidaSumarioDto;
}

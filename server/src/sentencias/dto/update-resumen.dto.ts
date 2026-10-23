import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateResumenDto {
  @ApiPropertyOptional({
    example: 'Resumen breve del fallo redactado por operador.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  resumenIa?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  resumenPublicado?: boolean;

  @ApiPropertyOptional({ example: 'manual', enum: ['manual', 'ia'] })
  @IsOptional()
  @IsIn(['manual', 'ia'])
  resumenFuente?: 'manual' | 'ia';
}

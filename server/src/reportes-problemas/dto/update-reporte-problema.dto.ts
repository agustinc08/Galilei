import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  ESTADOS_REPORTE_PROBLEMA,
  PRIORIDADES_REPORTE_PROBLEMA,
} from './query-reportes-problema.dto';

export class UpdateReporteProblemaDto {
  @ApiPropertyOptional({ enum: ESTADOS_REPORTE_PROBLEMA })
  @IsOptional()
  @IsIn(ESTADOS_REPORTE_PROBLEMA)
  estado?: (typeof ESTADOS_REPORTE_PROBLEMA)[number];

  @ApiPropertyOptional({ enum: PRIORIDADES_REPORTE_PROBLEMA })
  @IsOptional()
  @IsIn(PRIORIDADES_REPORTE_PROBLEMA)
  prioridad?: (typeof PRIORIDADES_REPORTE_PROBLEMA)[number];

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @IsString()
  @MaxLength(4000)
  notasAdmin?: string;

  @ApiPropertyOptional({
    description: 'ID del reporte original; null quita la relación.',
  })
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsInt()
  duplicadoDeId?: number | null;
}

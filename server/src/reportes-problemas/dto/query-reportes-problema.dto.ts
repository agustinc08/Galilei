import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const ESTADOS_REPORTE_PROBLEMA = [
  'NUEVO',
  'EN_ANALISIS',
  'REPRODUCIDO',
  'EN_CORRECCION',
  'RESUELTO',
  'PENDIENTE_VALIDACION',
  'CERRADO',
] as const;

export const PRIORIDADES_REPORTE_PROBLEMA = ['P0', 'P1', 'P2', 'P3'] as const;

export class QueryReportesProblemaDto {
  @IsOptional()
  @IsIn(ESTADOS_REPORTE_PROBLEMA)
  estado?: (typeof ESTADOS_REPORTE_PROBLEMA)[number];

  @IsOptional()
  @IsIn(PRIORIDADES_REPORTE_PROBLEMA)
  prioridad?: (typeof PRIORIDADES_REPORTE_PROBLEMA)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

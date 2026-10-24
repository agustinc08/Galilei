import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class QueryLogsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  usuarioId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entidad?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accion?: string;

  @ApiPropertyOptional({
    description: 'ID de documento Corpus asociado al evento',
  })
  @IsOptional()
  @IsString()
  documentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  fechaDesde?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  fechaHasta?: Date;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsOptional, IsString } from 'class-validator';
import {
  BooleanQuery,
  PaginationQueryDto,
} from '../../common/dto/pagination-query.dto';

export class QuerySentenciasDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'Sala A' })
  @IsOptional()
  @IsString()
  sala?: string;

  @ApiPropertyOptional({ example: 'Definitivo' })
  @IsOptional()
  @IsString()
  tipoFallo?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @BooleanQuery()
  @IsBoolean()
  publicado?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @BooleanQuery()
  @IsBoolean()
  activo?: boolean;

  @ApiPropertyOptional({
    example: true,
    description:
      'Excluye las sentencias del conjunto que requiere revisión de publicación.',
  })
  @IsOptional()
  @BooleanQuery()
  @IsBoolean()
  excluirRevision?: boolean;

  @ApiPropertyOptional({ example: 'EXP 123' })
  @IsOptional()
  @IsString()
  expediente?: string;

  @ApiPropertyOptional({ example: '123/2026' })
  @IsOptional()
  @IsString()
  numeroSentencia?: string;

  @ApiPropertyOptional({ example: '2026-01-01T00:00:00.000Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  fechaDesde?: Date;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59.999Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  fechaHasta?: Date;

  @ApiPropertyOptional({ example: 'Juan Perez' })
  @IsOptional()
  @IsString()
  actor?: string;

  @ApiPropertyOptional({ example: 'Empresa SA' })
  @IsOptional()
  @IsString()
  demandado?: string;
}

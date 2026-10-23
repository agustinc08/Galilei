import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import {
  BooleanQuery,
  PaginationQueryDto,
} from '../../common/dto/pagination-query.dto';

export class QuerySumariosDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sentenciaId?: number;

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

  @ApiPropertyOptional({ example: 'Responsabilidad' })
  @IsOptional()
  @IsString()
  tema?: string;

  @ApiPropertyOptional({ example: 'SUM 1' })
  @IsOptional()
  @IsString()
  numeroSumario?: string;
}

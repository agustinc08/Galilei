import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { BooleanQuery } from '../../common/dto/pagination-query.dto';

export class QueryNormasDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  codigo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  articulo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  numeroNorma?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @BooleanQuery()
  @IsBoolean()
  vigente?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}

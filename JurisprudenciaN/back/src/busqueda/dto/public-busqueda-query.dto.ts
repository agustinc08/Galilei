import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  BooleanQuery,
} from '../../common/dto/pagination-query.dto';

function toStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => String(item).split(',')).map((item) => item.trim()).filter(Boolean);
  }

  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export class PublicBusquedaQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 25, minimum: 1, maximum: 300 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(300)
  pageSize?: number = 25;

  @ApiPropertyOptional({ example: 'danio moral' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ example: 'danio moral' })
  @IsOptional()
  @IsString()
  fraseExacta?: string;

  @ApiPropertyOptional({ example: 'penal,tributario' })
  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  excluir?: string[];

  @ApiPropertyOptional({ enum: ['AND', 'OR'], example: 'AND' })
  @IsOptional()
  @IsIn(['AND', 'OR'])
  operador?: 'AND' | 'OR';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tema?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sala?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tipoFallo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tribunalOrigen?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  numeroSumario?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  numeroSentencia?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  magistrados?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  caratula?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  expediente?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  actor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  demandado?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  objeto?: string;

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

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2100)
  anio?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @BooleanQuery()
  @IsBoolean()
  soloConPdf?: boolean;

  @ApiPropertyOptional({ enum: ['todos', 'conPdf', 'sinPdf'], example: 'todos' })
  @IsOptional()
  @IsIn(['todos', 'conPdf', 'sinPdf'])
  pdf?: 'todos' | 'conPdf' | 'sinPdf';

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @BooleanQuery()
  @IsBoolean()
  tienePdf?: boolean;

  @ApiPropertyOptional({
    example: 'sentencia,sumario,resena,referencias',
    description: 'Lista separada por comas',
  })
  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  buscarEn?: string[];

  @ApiPropertyOptional({
    enum: ['fecha', 'relevancia', 'sala', 'numeroSentencia'],
    example: 'relevancia',
  })
  @IsOptional()
  @IsIn(['fecha', 'relevancia', 'sala', 'numeroSentencia'])
  sortBy?: 'fecha' | 'relevancia' | 'sala' | 'numeroSentencia';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], example: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

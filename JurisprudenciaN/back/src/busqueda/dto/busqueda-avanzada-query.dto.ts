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
  PaginationQueryDto,
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

export class BusquedaAvanzadaQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'mala praxis OR "danio moral" -penal' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: 'Limita los resultados Corpus a una colección Digesto' })
  @IsOptional()
  @IsString()
  digestoCollectionId?: string;

  @ApiPropertyOptional({ description: 'Limita los resultados Corpus a un tema Digesto local' })
  @IsOptional()
  @IsString()
  digestoTopicId?: string;

  @ApiPropertyOptional({ description: 'Limita los resultados Corpus a una etiqueta Digesto local' })
  @IsOptional()
  @IsString()
  digestoTagId?: string;

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
  numeroSentencia?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  numeroSumario?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  expediente?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  caratula?: string;

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
  @IsString()
  magistrados?: string;

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
  tema?: string;

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
  publicado?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @BooleanQuery()
  @IsBoolean()
  activo?: boolean;

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

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @BooleanQuery()
  @IsBoolean()
  soloConResumen?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @BooleanQuery()
  @IsBoolean()
  destacada?: boolean;

  @ApiPropertyOptional({
    example: 'sentencia,sumario,resumen,resena',
    description: 'Lista separada por comas',
  })
  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  buscarEn?: string[];

  @ApiPropertyOptional({ enum: ['fecha', 'relevancia', 'sala', 'numeroSentencia'], example: 'relevancia' })
  @IsOptional()
  @IsIn(['fecha', 'relevancia', 'sala', 'numeroSentencia'])
  sortBy?: 'fecha' | 'relevancia' | 'sala' | 'numeroSentencia';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], example: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

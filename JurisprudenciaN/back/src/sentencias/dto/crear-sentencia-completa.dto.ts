import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { CreateReferenciaDoctrinariaDto } from '../../referencias-doctrinarias/dto/create-referencia-doctrinaria.dto';
import { CreateReferenciaJurisprudencialDto } from '../../referencias-jurisprudenciales/dto/create-referencia-jurisprudencial.dto';
import { CreateReferenciaNormativaDto } from '../../referencias-normativas/dto/create-referencia-normativa.dto';
import { CreateSumarioDto } from '../../sumarios/dto/create-sumario.dto';
import { CreateSentenciaDto } from './create-sentencia.dto';

function OmitTypeCompat<T extends typeof CreateSumarioDto>(
  classRef: T,
  keys: readonly ['sentenciaId'],
) {
  return OmitType(classRef, keys);
}

export class CrearSentenciaCompletaSumarioDto extends OmitTypeCompat(
  CreateSumarioDto,
  ['sentenciaId'] as const,
) {}

export class OpcionesPublicacionDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  publicarSentencia?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  publicarSumarios?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  publicarResena?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  anonimizar?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  generarSlugPublico?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  destacada?: boolean;

  @ApiPropertyOptional({ example: 'PUBLICADA' })
  @IsOptional()
  @IsString()
  estadoCarga?: string;
}

export class CrearSentenciaCompletaDto {
  @ApiProperty({ type: CreateSentenciaDto })
  @ValidateNested()
  @Type(() => CreateSentenciaDto)
  sentencia!: CreateSentenciaDto;

  @ApiPropertyOptional({ type: [CrearSentenciaCompletaSumarioDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CrearSentenciaCompletaSumarioDto)
  sumarios?: CrearSentenciaCompletaSumarioDto[];

  @ApiPropertyOptional({ example: 'Reseña editorial del caso' })
  @IsOptional()
  @IsString()
  resena?: string;

  @ApiPropertyOptional({ type: [CreateReferenciaNormativaDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateReferenciaNormativaDto)
  referenciasNormativas?: CreateReferenciaNormativaDto[];

  @ApiPropertyOptional({ type: [CreateReferenciaJurisprudencialDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateReferenciaJurisprudencialDto)
  referenciasJurisprudenciales?: CreateReferenciaJurisprudencialDto[];

  @ApiPropertyOptional({ type: [CreateReferenciaDoctrinariaDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateReferenciaDoctrinariaDto)
  referenciasDoctrinarias?: CreateReferenciaDoctrinariaDto[];

  @ApiPropertyOptional({
    type: OpcionesPublicacionDto,
    description: 'Opciones de publicación y estado final para la sentencia creada',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => OpcionesPublicacionDto)
  opcionesPublicacion?: OpcionesPublicacionDto;
}
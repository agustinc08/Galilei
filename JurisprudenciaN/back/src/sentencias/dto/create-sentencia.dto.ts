import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateSentenciaDto {
  @ApiPropertyOptional({ example: '123/2026' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  numeroSentencia?: string;

  @ApiPropertyOptional({ example: 'Definitivo' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  tipoFallo?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  tipoFalloId?: number;

  @ApiPropertyOptional({ example: 'Sala A' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sala?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  salaId?: number;

  @ApiPropertyOptional({ example: '2026-04-23T00:00:00.000Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  fecha?: Date;

  @ApiPropertyOptional({ example: 'EXP 12345/2026' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  expediente?: string;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  tribunalOrigenId?: number;

  @ApiPropertyOptional({
    example: 'Juzgado Nacional de Primera Instancia en lo Civil N° 1',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  tribunalOrigen?: string;

  @ApiPropertyOptional({ example: 'Juan Perez' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  actor?: string;

  @ApiPropertyOptional({ example: 'Empresa SA' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  demandado?: string;

  @ApiPropertyOptional({ example: 'Perez c/ Gomez s/ danos y perjuicios' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  caratula?: string;

  @ApiPropertyOptional({ example: 'Daños y perjuicios' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  objeto?: string;

  @ApiPropertyOptional({ example: 'Dra. Gomez; Dr. Lopez' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  magistrados?: string;

  @ApiPropertyOptional({ example: 'Notas internas no publicas' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  observacionesInternas?: string;

  @ApiPropertyOptional({ example: 'Resumen del fallo para consulta rapida' })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  resumenIa?: string;

  @ApiPropertyOptional({ example: 'Reseña editorial del caso' })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  resena?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  resumenPublicado?: boolean;

  @ApiPropertyOptional({ example: 'manual' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  resumenFuente?: string;

  @ApiPropertyOptional({ example: 'Perez c/ Gomez, Sala A, 12/03/2024' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  citaPersonalizada?: string;

  @ApiPropertyOptional({ example: 'perez-c-gomez-sala-a-123' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  slugPublico?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  destacada?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  publicado?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @ApiPropertyOptional({ example: 'BORRADOR' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  estadoCarga?: string;
}

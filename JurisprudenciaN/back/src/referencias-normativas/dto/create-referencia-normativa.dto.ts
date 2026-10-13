import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateReferenciaNormativaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  normaArticuloId?: number;

  @ApiProperty({ example: 'CCyC' })
  @IsString()
  @MaxLength(100)
  tipoNorma!: string;

  @ApiPropertyOptional({ example: '1775' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  numeroNorma?: string;

  @ApiPropertyOptional({ example: '1757' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  articulo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  inciso?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  textoReferencia?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;
}

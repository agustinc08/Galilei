import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateNormaArticuloDto {
  @ApiProperty({ example: 'CCyC' })
  @IsString()
  @MaxLength(50)
  codigo!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  numeroNorma?: string;

  @ApiProperty({ example: '1757' })
  @IsString()
  @MaxLength(100)
  articulo!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  titulo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  texto?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  vigente?: boolean;
}

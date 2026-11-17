import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateInstitutoJuridicoDto {
  @ApiProperty({ example: 'responsabilidad parental' })
  @IsString()
  @MaxLength(255)
  nombre!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descripcion?: string;

  @ApiPropertyOptional({ example: 'Responsabilidad civil' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  materia?: string;

  @ApiPropertyOptional({ example: 'Corpus interno publicado' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fuente?: string;

  @ApiPropertyOptional({ example: 'SUMARIO:12345' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  identificadorFuente?: string;
}

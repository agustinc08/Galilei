import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSinonimoJuridicoDto {
  @ApiProperty({ example: 'patria potestad' })
  @IsString()
  @MaxLength(255)
  termino!: string;

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

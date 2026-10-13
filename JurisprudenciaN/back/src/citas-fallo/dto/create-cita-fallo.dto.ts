import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateCitaFalloDto {
  @ApiProperty({ example: 'FALLOS' })
  @IsString()
  @MaxLength(50)
  tipo!: string;

  @ApiProperty({ example: 'Fallos: 342:533' })
  @IsString()
  @MaxLength(255)
  referencia!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  textoOriginal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  contexto?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  pagina?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  confirmada?: boolean;
}

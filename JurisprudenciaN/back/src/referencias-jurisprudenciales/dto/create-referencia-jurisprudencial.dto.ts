import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateReferenciaJurisprudencialDto {
  @ApiProperty({ example: 'Fallos 342:533' })
  @IsString()
  @MaxLength(255)
  referencia!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  falloRelacionadoId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  textoOriginal?: string;
}

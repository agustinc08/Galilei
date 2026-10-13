import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateEquivalenciaNormativaDto {
  @ApiProperty()
  @IsInt()
  articuloDestinoId!: number;

  @ApiProperty({ example: 'equivalente' })
  @IsString()
  @MaxLength(50)
  tipoRelacion!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observacion?: string;
}

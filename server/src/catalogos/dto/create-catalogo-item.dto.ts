import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCatalogoItemDto {
  @ApiProperty({ example: 'Sala A' })
  @IsString()
  @MaxLength(120)
  nombre!: string;

  @ApiPropertyOptional({ example: 'A' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  codigo?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  orden?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

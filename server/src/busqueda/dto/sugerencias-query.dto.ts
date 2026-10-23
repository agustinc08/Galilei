import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class SugerenciasQueryDto {
  @ApiPropertyOptional({ example: 'danio' })
  @IsOptional()
  @IsString()
  q?: string;
}

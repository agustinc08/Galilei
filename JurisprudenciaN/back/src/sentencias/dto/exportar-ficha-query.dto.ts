import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export class ExportarFichaQueryDto {
  @ApiPropertyOptional({ enum: ['html', 'txt', 'json'], example: 'json' })
  @IsOptional()
  @IsIn(['html', 'txt', 'json'])
  formato?: 'html' | 'txt' | 'json' = 'json';
}

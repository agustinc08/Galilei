import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional } from 'class-validator';

export class TrackShareLinkDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  sentenciaId?: number;
}

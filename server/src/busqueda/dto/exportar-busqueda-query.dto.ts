import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { BusquedaAvanzadaQueryDto } from './busqueda-avanzada-query.dto';

export class ExportarBusquedaQueryDto extends BusquedaAvanzadaQueryDto {
  @ApiPropertyOptional({ enum: ['csv', 'json', 'txt'], example: 'csv' })
  @IsOptional()
  @IsIn(['csv', 'json', 'txt'])
  formato?: 'csv' | 'json' | 'txt' = 'csv';
}

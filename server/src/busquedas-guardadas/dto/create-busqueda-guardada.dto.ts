import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsString, MaxLength } from 'class-validator';

export class CreateBusquedaGuardadaDto {
  @ApiProperty({ example: 'Busqueda por danos y perjuicios' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nombre: string;

  @ApiProperty({
    example: {
      tema: 'danos',
      sala: 'A',
      fechaDesde: '2024-01-01',
    },
  })
  @IsObject()
  queryJson: Record<string, unknown>;
}

import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, ValidateNested } from 'class-validator';
import { CrearSentenciaCompletaSumarioDto } from './crear-sentencia-completa.dto';

export class CrearSumariosLoteDto {
  @ApiProperty({ type: [CrearSentenciaCompletaSumarioDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CrearSentenciaCompletaSumarioDto)
  sumarios!: CrearSentenciaCompletaSumarioDto[];
}

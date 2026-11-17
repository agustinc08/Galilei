import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetVocabularyActivationDto {
  @ApiProperty({
    description: 'Habilita o deshabilita la voz para sugerencias.',
  })
  @IsBoolean()
  activo!: boolean;
}

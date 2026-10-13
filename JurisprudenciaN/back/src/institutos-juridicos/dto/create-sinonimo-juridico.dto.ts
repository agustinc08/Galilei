import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class CreateSinonimoJuridicoDto {
  @ApiProperty({ example: 'patria potestad' })
  @IsString()
  @MaxLength(255)
  termino!: string;
}

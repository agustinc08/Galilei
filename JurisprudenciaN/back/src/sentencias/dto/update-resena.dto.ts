import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class UpdateResenaDto {
  @ApiProperty({ example: 'Reseña editorial y contextual del caso.' })
  @IsString()
  @MaxLength(8000)
  resena!: string;
}

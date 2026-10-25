import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, Matches } from 'class-validator';

export class CreateCollectionDto {
  @ApiProperty({ example: 'Responsabilidad civil' })
  @Transform(({ value }) => {
    const input: unknown = value;
    return typeof input === 'string' ? input.trim() : input;
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/u)
  @MaxLength(100)
  nombre!: string;
}

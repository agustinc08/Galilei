import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength } from 'class-validator';

export class UpdateCollectionNoteDto {
  @ApiProperty({
    example: 'Útil para responsabilidad objetiva; revisar considerando 4.',
  })
  @Transform(({ value }) => {
    const input: unknown = value;
    return typeof input === 'string' ? input.trim() : input;
  })
  @IsString()
  @MaxLength(5000)
  nota!: string;
}

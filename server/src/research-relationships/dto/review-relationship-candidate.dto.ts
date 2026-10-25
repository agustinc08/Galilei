import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

export class ReviewRelationshipCandidateDto {
  @ApiProperty({ enum: ['VERIFIED', 'REJECTED', 'UNRESOLVED'] })
  @IsIn(['VERIFIED', 'REJECTED', 'UNRESOLVED'])
  status!: 'VERIFIED' | 'REJECTED' | 'UNRESOLVED';

  @ApiProperty({
    required: false,
    description:
      'Destino confirmado; si se omite se usa el destino propuesto por la extracción.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  targetSentenceId?: number;
}

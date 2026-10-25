import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class RelationshipCandidatesQueryDto {
  @IsOptional()
  @IsIn(['DETECTED_CANDIDATE', 'VERIFIED', 'REJECTED', 'UNRESOLVED'])
  status?: 'DETECTED_CANDIDATE' | 'VERIFIED' | 'REJECTED' | 'UNRESOLVED';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 50;
}

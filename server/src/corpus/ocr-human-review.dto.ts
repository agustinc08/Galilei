import { Type } from 'class-transformer';
import { IsInt, IsString, MaxLength, Min, ValidateIf } from 'class-validator';

export const OCR_REVIEW_PAGE_TEXT_LIMIT = 120_000;

export class SaveOcrReviewPageDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ValidateIf((value: SaveOcrReviewPageDto) => value.correctedText !== null)
  @IsString()
  @MaxLength(OCR_REVIEW_PAGE_TEXT_LIMIT)
  correctedText!: string | null;
}

export class ReviewPageVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

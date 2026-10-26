import { IsDateString } from 'class-validator';

export class MarkNoveltiesViewedDto {
  @IsDateString()
  viewedThrough!: string;
}

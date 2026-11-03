import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import {
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_QUERY_TOO_LONG_MESSAGE,
} from '../search-query-constraints';

export class SugerenciasQueryDto {
  @ApiPropertyOptional({ example: 'danio', maxLength: SEARCH_QUERY_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SEARCH_QUERY_MAX_LENGTH, {
    message: SEARCH_QUERY_TOO_LONG_MESSAGE,
  })
  q?: string;
}

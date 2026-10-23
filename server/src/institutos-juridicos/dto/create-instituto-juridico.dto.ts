import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateInstitutoJuridicoDto {
  @ApiProperty({ example: 'responsabilidad parental' })
  @IsString()
  @MaxLength(255)
  nombre!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descripcion?: string;
}

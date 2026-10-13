import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ example: 'Admin12345' })
  @IsString()
  @MinLength(6)
  currentPassword!: string;

  @ApiProperty({ example: 'Nueva12345' })
  @IsString()
  @MinLength(6)
  newPassword!: string;
}

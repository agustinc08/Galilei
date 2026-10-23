import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@jurisprudencia.local' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Admin12345' })
  @IsString()
  @MinLength(6)
  password!: string;
}

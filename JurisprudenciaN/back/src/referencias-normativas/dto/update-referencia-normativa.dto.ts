import { PartialType } from '@nestjs/swagger';
import { CreateReferenciaNormativaDto } from './create-referencia-normativa.dto';

export class UpdateReferenciaNormativaDto extends PartialType(
  CreateReferenciaNormativaDto,
) {}

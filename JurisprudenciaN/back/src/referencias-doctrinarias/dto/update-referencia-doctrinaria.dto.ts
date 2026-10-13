import { PartialType } from '@nestjs/swagger';
import { CreateReferenciaDoctrinariaDto } from './create-referencia-doctrinaria.dto';

export class UpdateReferenciaDoctrinariaDto extends PartialType(
  CreateReferenciaDoctrinariaDto,
) {}

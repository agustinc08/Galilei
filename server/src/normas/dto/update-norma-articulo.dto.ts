import { PartialType } from '@nestjs/swagger';
import { CreateNormaArticuloDto } from './create-norma-articulo.dto';

export class UpdateNormaArticuloDto extends PartialType(
  CreateNormaArticuloDto,
) {}

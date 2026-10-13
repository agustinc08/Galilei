import { PartialType } from '@nestjs/swagger';
import { CreateReferenciaJurisprudencialDto } from './create-referencia-jurisprudencial.dto';

export class UpdateReferenciaJurisprudencialDto extends PartialType(
  CreateReferenciaJurisprudencialDto,
) {}

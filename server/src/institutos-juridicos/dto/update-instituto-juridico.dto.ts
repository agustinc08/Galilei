import { PartialType } from '@nestjs/swagger';
import { CreateInstitutoJuridicoDto } from './create-instituto-juridico.dto';

export class UpdateInstitutoJuridicoDto extends PartialType(
  CreateInstitutoJuridicoDto,
) {}

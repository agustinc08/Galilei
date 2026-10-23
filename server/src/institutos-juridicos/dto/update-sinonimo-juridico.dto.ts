import { PartialType } from '@nestjs/swagger';
import { CreateSinonimoJuridicoDto } from './create-sinonimo-juridico.dto';

export class UpdateSinonimoJuridicoDto extends PartialType(
  CreateSinonimoJuridicoDto,
) {}

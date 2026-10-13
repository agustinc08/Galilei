import { PartialType } from '@nestjs/swagger';
import { CreateSentenciaDto } from './create-sentencia.dto';

export class UpdateSentenciaDto extends PartialType(CreateSentenciaDto) {}

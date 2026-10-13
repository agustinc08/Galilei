import { PartialType } from '@nestjs/swagger';
import { CreateSumarioDto } from './create-sumario.dto';

export class UpdateSumarioDto extends PartialType(CreateSumarioDto) {}

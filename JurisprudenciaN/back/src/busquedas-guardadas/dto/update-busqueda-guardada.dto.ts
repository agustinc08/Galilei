import { PartialType } from '@nestjs/swagger';
import { CreateBusquedaGuardadaDto } from './create-busqueda-guardada.dto';

export class UpdateBusquedaGuardadaDto extends PartialType(
  CreateBusquedaGuardadaDto,
) {}

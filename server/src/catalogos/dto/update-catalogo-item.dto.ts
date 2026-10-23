import { PartialType } from '@nestjs/swagger';
import { CreateCatalogoItemDto } from './create-catalogo-item.dto';

export class UpdateCatalogoItemDto extends PartialType(CreateCatalogoItemDto) {}

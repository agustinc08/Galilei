import { Controller, Get } from '@nestjs/common';
import { DependenciaService } from './dependencia.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Dependencia')
@Controller('dependencia')
export class DependenciaController {
constructor(private readonly useService:DependenciaService){}

@ApiOperation({ summary: 'Devuelve todas las dependencias cargadas en la base.' })
@Get('GetAll')
async  GetAll() {
return this.useService.getAll()
}
}

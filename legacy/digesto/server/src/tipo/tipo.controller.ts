import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { TipoService } from './tipo.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';


@ApiTags('Tipo')
@Controller('tipo')
export class TipoController {
constructor (private useService:TipoService){}

@Post('create')
@ApiOperation({ summary: 'Creacion de tipos , unicamente se le pasa por el body :Nombre' })
async create(@Body('nombre')nombre:string){
    return this.useService.createTipo(nombre)
}

@Delete('delete')
@ApiOperation({ summary: 'Borrar tipo, se realiza por el body la solicitud' })
async delete(@Body('id')id:number ){
return this.useService.borrarTipo(id)
}
@Get('getAll')
@ApiOperation({ summary: 'Devuelve todos los Tipos que estan en base.' })
async getAll(){
    return this.useService.getAll()
}
@Post('edit')
@ApiOperation({ summary: 'Editar los tipos, se hace por medio del body y se le pasa el nombre y el id.' })
async edit(@Body('nombre') nombre:string,@Body("id") id:number){
return this.useService.editDocumento({nombre:nombre ,id:id })
}

}

import { Controller, Post, UseInterceptors, HttpCode, UploadedFile, Body, Param, ParseIntPipe, Get, Query, Delete, Res } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CargaDeDatosService } from './carga-de-datos.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { log } from 'console';


@ApiTags('Carga de datos')
@Controller('carga-de-datos')
export class CargaDeDatosController {
  constructor(private readonly cargaDeDatosService: CargaDeDatosService) { }
  //GET---------


  @Get('ultimo-numero')
  @ApiOperation({ summary: 'Obtienne el ultimo numero de los documentos' })
  async obtenerUltimoNumero() {
    return await this.cargaDeDatosService.obtenerUltimoNumero()
  }


  @Get('obtener-datos')
  @ApiOperation({ summary: 'Obtiene todos los elementos filtrados por el body de la solicitud ( fechaInicio, fechaFin, numero, texto, textoPdf)' })
  async obtenerDatos(@Query() filters: any) {
    try {
      const datos = await this.cargaDeDatosService.obtenerDatos(filters);
      return { message: 'Datos obtenidos correctamente', data: datos };
    } catch (error) {
      return error
    }

  }
  //POST---------

  //Guarda desde la carga normal el idDocAsociado, lo manda pero se setea en 0 ya que no se puede asociar si es la carga normal.
  @Post('guardar-datos')
  @UseInterceptors(FileInterceptor('pdf'))
  @ApiOperation({ summary: 'Creacion standard de documentos con subida de pdfs. Todo se enviara por el body.' })
  @HttpCode(200)
  async guardarDatos(
    @UploadedFile() pdf: Express.Multer.File,
    @Body('numero', ParseIntPipe) numero: number,
    @Body('tipo',ParseIntPipe) tipo: number,
    @Body('voz') voz: string,
    @Body('fecha') fecha: Date,
    @Body('dependencias') dependencias: string,
    @Body('pendiente') pendiente: string
  ) {
    try {
      const result = await this.cargaDeDatosService.guardarDatos({
        pdf,
        numero,
        tipo,
        voz,
        fecha,
        dependencias,
        pendiente
      });

      return { message: 'Datos guardados correctamente', result };
    } catch (error) {
      return error
    }

  }
  //Editar datos, se puede editar NUMERO TIPO Y VOZ
  @Post('editar-datos/:id')
  @UseInterceptors(FileInterceptor('pdf'))
  @ApiOperation({ summary: 'Edicion de documentos ya cargados. Solicita por parametro el id y luego se envia por el body los campos a modificar (Numero .) ' })
  async editarDatos(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() pdf: Express.Multer.File,
    @Body('numero') numero: number,
    @Body('tipo',ParseIntPipe) tipo: number,
    @Body('voz') voz: string,
    @Body('dependencias') dependencias: string,
    @Body('pendiente') pendiente: string
  ) {



    try {
      const result = await this.cargaDeDatosService.editarDatos({ numero, tipo, voz, id, dependencias, pdf,pendiente });
      return { message: 'Datos editados correctamente', result };
    } catch (error) {
      return error
    }

  }

  //Carga mediante asociacion. Este endpoint te da la posibilidad de cargar y asociar. Esto se haria desde un nuevo registro, por lo que se debe mantener el id
  //del documento padre.
  @Post('asociar-nuevo-archivo')
  @UseInterceptors(FileInterceptor('pdf'))
  @ApiOperation({ summary: 'Carga de un nuevo archivo que tiene una asociacion. Se le pasa si o si el idDocAsociado, el cual debe existir para poder ser creado.' })
  @HttpCode(200)
  async asociarNuevoArchivo(
    @UploadedFile() pdf: Express.Multer.File,
    @Body('numero', ParseIntPipe) numero: number,
    @Body('tipo',ParseIntPipe) tipo: number,
    @Body('voz') voz: string,
    @Body('fecha') fecha: Date,
    @Body('idDocAsociado', ParseIntPipe) idDocAsociado: number,
    @Body('dependencias') dependencias: string,
    @Body('pendiente') pendiente: string
  ) {
    try {
      const result = await this.cargaDeDatosService.asociarNuevoArchivo({ pdf, numero, tipo, voz, fecha, idDocAsociado, dependencias, pendiente })
      return result
    } catch (error) {
      return error
    }


  }
  //DELETE
  ////BORRA SOLO Y UNICAMENTE SI NO TIENE UN ARCHIVO QUE YA ESTE ASOCIADO A EL QUE SE VA A BORRAR.
  @Delete('borrar-datos/:id')
  @ApiOperation({ summary: 'Eliminacion de doc en base, se le pasa el id por parametro (URL).' })
  async borrarDatos(@Param('id') id: number) {
    try {
      const result = await this.cargaDeDatosService.borrarDocumento(Number(id));
      return { message: 'Datos borrados correctamente', result };
    } catch (error: any) {
      if (error instanceof Error) {
        // hacer algo con error.message
        return error.message
      } else {
        return error.message

      }
    }
  }


}

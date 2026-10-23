import { Controller,Get,Param,Res } from '@nestjs/common';
import { PdfService } from './pdf.service'
import { Response } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';


@Controller('pdf')
@ApiTags('Pdf')
export class PdfController {
constructor(private readonly pdfService:PdfService){

}

    @ApiOperation({ summary: 'Devuelve al browser el pdf , la solicitud se hace por parametro pasandole el nombre del pdf(EXACTO)' })
    @Get(':filename')
    async serveFile(@Param('filename') filename: string, @Res() res: Response): Promise<void> {
      try {
        // Obtener la ruta del archivo del servicio
        const filePath = await this.pdfService.getFilePath(filename);

        // Envía el archivo como respuesta
        res.sendFile(filePath);
      } catch (error) {
        console.error('Error al servir el archivo:', error);
        // Manejar el error según sea necesario
        res.status(500).send('Error interno del servidor');
      }
    }
}

import { Injectable } from '@nestjs/common';
import * as path from 'path';

@Injectable()
export class PdfService {
  //Recuperar doc de el servidor

    async getFilePath(filename: string): Promise<string> {
        // Lógica para obtener la ubicación del archivo en el servidor
        const uploadDirectory = '/home/node/pdfs/'; // Ruta del directorio de carga
        console.log(uploadDirectory+filename)
        const filePath = path.join(uploadDirectory, filename );
        return filePath;
      }

}7

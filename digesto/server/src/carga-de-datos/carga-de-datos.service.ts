import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import pdf from 'pdf-parse';

//interfaces usadas
export interface DatosParaGuardar {
  pdf: Express.Multer.File;
  numero: number;
  tipo: number;
  voz: string;
  fecha: Date;
  idDocAsociado?: number;
  dependencias: string;
  pendiente: string
}
export interface DatosParaEditar {
  numero: number
  pdf: Express.Multer.File
  tipo: number;
  voz: string
  id: number
  dependencias: string
  pendiente: string
}

async function verificarNombreArchivoDirectorio(rutaDirectorio: string, nombreArchivo: string): Promise<string> {
  let nombreArchivoModificado = nombreArchivo;
  const extension = path.extname(nombreArchivo);
  const nombreBase = path.basename(nombreArchivo, extension);

  let contador = 1;
  while (fs.existsSync(path.join(rutaDirectorio, nombreArchivoModificado))) {
    nombreArchivoModificado = `${nombreBase} (${contador})${extension}`;
    contador++;
  }

  return nombreArchivoModificado;
}

@Injectable()
export class CargaDeDatosService {

  constructor(private prisma: PrismaClient) { }  //POST

  //Carga normal. Se le envia idDocAsociado pero siempre lo setea en 0, ya que seria el doc "padre"
  async guardarDatos(data: DatosParaGuardar) {

    console.log(data)
    const uploadDirectory = '/home/node/pdfs';
    data.pdf.originalname = await verificarNombreArchivoDirectorio(uploadDirectory, data.pdf.originalname)

    const pdfPath = path.join(uploadDirectory, data.pdf.originalname);
    let pdfContent: string | undefined;

    const arrayIdsDependencias = data.dependencias.split(',').map(numero => parseInt(numero, 10))

    // Verificar si el directorio existe, y crearlo si no existe
    if (!fs.existsSync(uploadDirectory)) {
      fs.mkdirSync(uploadDirectory, { recursive: true });
    }
    // Guardar el archivo en la carpeta especificada
    fs.writeFileSync(pdfPath, data.pdf.buffer);

    try {
      const pdfBuffer = fs.readFileSync(pdfPath);
      pdfContent = await leerContenidoPdf(pdfBuffer);
    } catch (error) {
      console.error('Error al leer el contenido del PDF:', error);
    }

    console.log("LLegue")
    // Guardar los datos en la base de datos
    try {
      const result = await this.prisma.doc.create({
        data: {
          numero: data.numero,
          path: data.pdf.originalname,
          pdfContent: pdfContent ? pdfContent.toLowerCase() : "",
          tipo: data.tipo,
          voz: data.voz,
          fecha: data.fecha,
          idDocAsociado: 0,
          pendiente: data.pendiente === "1" ? true : false
        },
      });
      console.log("LLegue 2")

      for (const a of arrayIdsDependencias) {
        await this.prisma.docDependencias.create({
          data: {
            idDocAsociado: result.id,
            idDependenciaAsociada: a,
          },
        });
      }


      return result;
    } catch (error) {
      throw new InternalServerErrorException('Error al guardar los datos ' + error);
    }

  }
  //edicion de datos correspondientes a cada documento. Debera recibir como parametro de URL el id del doc que se va a editar.
  async editarDatos(data: DatosParaEditar) {
    console.log(data);
    const arrayIdsDependencias = data.dependencias.split(',').map(numero => parseInt(numero, 10));
    const uploadDirectory = '/home/node/pdfs';

    try {
      // Eliminar todas las dependencias asociadas al documento
      await this.prisma.docDependencias.deleteMany({
        where: {
          idDocAsociado: data.id,
        },
      });

      // Actualizar los datos del documento
      const updateData: any = {
        tipo: data.tipo,
        voz: data.voz,
        numero: typeof data.numero === 'string' ? parseInt(data.numero, 10) : data.numero,
        pendiente: data.pendiente === "1" ? true : false
      };

      if (data.pdf) {
        const documentoExistente = await this.prisma.doc.findUnique({
          where: { id: data.id },
          select: { path: true }
        });

        if (!documentoExistente) {
          throw new Error('Documento no encontrado');
        }

        // Eliminar el PDF anterior si existe
        if (documentoExistente.path) {
          const pdfPathToDelete = path.join(uploadDirectory, documentoExistente.path);
          fs.unlinkSync(pdfPathToDelete);
        }

        // Guardar el nuevo PDF
        const newPdfPath = path.join(uploadDirectory, data.pdf.originalname);
        console.log(newPdfPath);

        fs.writeFileSync(newPdfPath, data.pdf.buffer);

        // Leer el contenido del nuevo PDF y guardarlo en minúsculas
        const pdfBuffer = fs.readFileSync(newPdfPath);
        let pdfContent = await leerContenidoPdf(pdfBuffer);
        if (pdfContent) {
          pdfContent = pdfContent.toLowerCase();
        }

        // Actualizar los datos del PDF en el documento
        updateData.path = path.basename(newPdfPath);
        updateData.pdfContent = pdfContent || ""; // Asegúrate de actualizar el contenido del PDF si es necesario
      }
      console.log("Llegue")
      const result = await this.prisma.doc.update({
        where: { id: data.id },
        data: updateData,
      });
      console.log("Llegue")
      // Agregar las nuevas dependencias al documento actualizado
      for (const a of arrayIdsDependencias) {
        await this.prisma.docDependencias.create({
          data: {
            idDocAsociado: result.id,
            idDependenciaAsociada: a,
          },
        });
      }

      return result;
    } catch (error) {
      throw new InternalServerErrorException('Error al editar los datos ' + error);
    }
  }



  //Carga del archivo asociado. Esto es una carga normal, pero se dispara de agregar un archivo en la busqueda. El id del doc seleccionado se debe enviar para poder relacionarlo
  //por base.
  async asociarNuevoArchivo(data: DatosParaGuardar) {
    console.log(data)
    const uploadDirectory = '/home/node/pdfs';
    data.pdf.originalname = await verificarNombreArchivoDirectorio(uploadDirectory, data.pdf.originalname)

    const pdfPath = path.join(uploadDirectory, data.pdf.originalname);
    let pdfContent: string | undefined;

    const arrayIdsDependencias = data.dependencias.split(',').map(numero => parseInt(numero, 10))



    // Verificar si el directorio existe, y crearlo si no existe
    if (!fs.existsSync(uploadDirectory)) {
      fs.mkdirSync(uploadDirectory, { recursive: true });
    }


    // Guardar el archivo en la carpeta especificada
    fs.writeFileSync(pdfPath, data.pdf.buffer);


    try {
      const pdfBuffer = fs.readFileSync(pdfPath);
      pdfContent = await leerContenidoPdf(pdfBuffer);
    } catch (error) {
      console.error('Error al leer el contenido del PDF:', error);
    }


    // Verificar si el idDocAsociado existe antes de intentar la creación
    const docAsociadoExistente = await this.prisma.doc.findUnique({
      where: { id: data.idDocAsociado },
    });
    if (docAsociadoExistente == null) {
      return 'El idDocAsociado especificado no existe en la base de datos.';
    }
    try {
      const result = await this.prisma.doc.create({
        data: {
          numero: data.numero,
          path: data.pdf.originalname,
          pdfContent: pdfContent ? pdfContent.toLowerCase() : "",
          tipo: data.tipo,
          voz: data.voz,
          fecha: data.fecha,
          idDocAsociado: data.idDocAsociado,
          pendiente: data.pendiente === "true" ? true : false
        },
      });
      for (const a of arrayIdsDependencias) {
        console.log(a);
        await this.prisma.docDependencias.create({
          data: {
            idDocAsociado: result.id,
            idDependenciaAsociada: a,
          },
        });
      }

      return result;
    } catch (error) {
      return error
    }

  }


  //GET

  //Lista de docs guardados. Los filtros se los manda por param de URL , se puede filtrar por rango de fechas ademas de por numero y voz.
  async obtenerDatos(filters: any) {
    const { fechaInicio, fechaFin, numero, texto, textoPdf } = filters;

    const where: Record<string, any> = {};

    if (fechaInicio && fechaFin) {
      where['fecha'] = {
        gte: new Date(fechaInicio),
        lte: new Date(fechaFin),
      };
    }

    if (numero) {
      where['numero'] = Number(numero);
    }

    if (texto) {
      where['OR'] = [
        { voz: { contains: texto } },
        { tipo: { contains: texto } },
      ];
    }

    if (textoPdf) {
      where['pdfContent'] = {
        contains: textoPdf,
      };
    }

    try {
      // Consulta para obtener los registros de Doc
      const docs = await this.prisma.doc.findMany({
        where,
        select: {
          id: true,
          numero: true,
          path: true,
          tipo: true,
          voz: true,
          idDocAsociado: true,
          fecha: true,
          pdfContent: true,
          pendiente: true
        },
      });
      // Obtener los nombres de los archivos de PDF
      const pdfUrls = docs.map((doc) => {
        const pathParts = doc.path.split('\\');
        const fileName = pathParts[pathParts.length - 1];
        return `http://cncivil04.pjn.gov.ar/api/pdf/${fileName}`;
      });

      // Obtener los IDs de los tipos únicos de los documentos
      const tipoIdsUnicos = Array.from(new Set(docs.map((doc) => doc.tipo)));

      // Consulta para obtener los nombres de los tipos
      const tipos = await this.prisma.tipo.findMany({
        where: {
          id: {
            in: tipoIdsUnicos,
          },
        },
        select: {
          id: true,
          nombre: true,
        },
      });

      // Crear un diccionario de tipos para acceso rápido por id
      const tiposDict = tipos.reduce((acc, tipo) => {
        acc[tipo.id] = tipo.nombre;
        return acc;
      }, {} as Record<number, string>);

      // Obtener los IDs de Doc para la siguiente consulta
      const idsDoc = docs.map((doc) => doc.id);

      // Consulta para obtener los IDs de las dependencias asociadas
      const dependenciasIds = await this.prisma.docDependencias.findMany({
        where: {
          idDocAsociado: {
            in: idsDoc,
          },
        },
        select: {
          idDocAsociado: true,
          idDependenciaAsociada: true,
        },
      });

      // Obtener los IDs de las dependencias
      const idsDependencias = dependenciasIds.map((dep) => dep.idDependenciaAsociada);

      // Consulta para obtener los detalles completos de las dependencias
      const dependencias = await this.prisma.dependencia.findMany({
        where: {
          id: {
            in: idsDependencias,
          },
        },
        select: {
          id: true,
          descripcion: true,
        },
      });

      // Mapear los resultados finales
      const resultadoFinal = docs.map((doc, index) => ({
        ...doc,
        pdfUrl: pdfUrls[index], // Agregar la URL del PDF al objeto de documento
        nombreTipo: tiposDict[doc.tipo] || 'Desconocido', // Agregar el nombre del tipo al objeto de documento
        dependencias: dependencias
          .filter((dep) => dependenciasIds.find((d) => d.idDocAsociado === doc.id && d.idDependenciaAsociada === dep.id))
          .map((dep) => ({
            id: dep.id,
            nombre: dep.descripcion,
          })),
      }));

      return resultadoFinal;
    } catch (error) {
      console.error('Error al consultar la base de datos:', error);
      throw error;
    }
  }

  async obtenerUltimoNumero() {
    const ultimoNumero = await this.prisma.doc.findFirst({
      select: {
        numero: true,
      },
      orderBy: {
        numero: 'desc',
      },
    });
    const numero = ultimoNumero ? ultimoNumero.numero : 0;
    return numero + 1
  }

  //DELETE

  ////BORRA SOLO Y UNICAMENTE SI NO TIENE UN ARCHIVO QUE YA ESTE ASOCIADO A EL QUE SE VA A BORRAR.
  async borrarDocumento(id: number) {
    // Verificar si el documento está asociado en otros documentos
    const uploadDirectory = '/home/node/pdfs';
    const documentosAsociados = await this.prisma.doc.findMany({
      where: {
        idDocAsociado: id,
      },
    });

    if (documentosAsociados.length > 0) {
      // Si hay documentos asociados, no permitir la eliminación
      throw new NotFoundException('El documento está asociado en otros documentos.');
    }

    try {
      const documento = await this.prisma.doc.findUnique({
        where: {
          id: id,
        },
      });

      if (!documento) {
        throw new NotFoundException('Documento no encontrado.');
      }

      await this.prisma.docDependencias.deleteMany({
        where: {
          idDocAsociado: id,
        },
      });
      // Eliminar el archivo PDF en el servidor
      const rutaPdf = path.join(uploadDirectory, documento.path);

      if (fs.existsSync(rutaPdf)) {
        fs.unlinkSync(rutaPdf);
        console.log(`El archivo ${rutaPdf} fue eliminado correctamente.`);
      } else {
        console.log(`El archivo ${rutaPdf} no existe.`);
      }// Elimina el archivo del sistema de archivos

      // Eliminar el documento en la base de datos
      await this.prisma.doc.delete({
        where: {
          id: id,
        },
      });

      return { message: 'Documento eliminado correctamente.' };
    } catch (error) {
      return error;
    }
  }

}

async function leerContenidoPdf(pdfBuffer: Buffer): Promise<string> {
  try {
    const pdfData = await pdf(pdfBuffer, { max: -1 });
    return pdfData.text;
  } catch (error: any) {
    throw new Error(`Error al leer el contenido del PDF: ${error.message}`);
  }
}

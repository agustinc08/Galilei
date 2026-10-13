import { Injectable } from '@nestjs/common';
import { PrismaClient, Tipo } from '@prisma/client';


export interface Documento {
    nombre: string;
    id: number;
  }


@Injectable()
export class TipoService {



    constructor(private prisma: PrismaClient) { }

    async createTipo(tipo: string): Promise<object> {
        try {
            const result = await this.prisma.tipo.create({
                data: {
                    nombre: tipo,
                },
            });

            return {'nombre' :result.nombre}; // Devolver el nombre del tipo creado
        } catch (error: any) {
            throw new Error(`Error al crear el tipo: ${error.message}`);
        }
    }

    async borrarTipo(id: number): Promise<string> {
        try {

            const tipoToDelete = await this.prisma.tipo.findUnique({
                where: {
                    id: id,
                },
            });

            if (!tipoToDelete) {
                throw new Error(`No se encontró ningún registro con el ID '${id}' para borrar.`);
            }

            const result = await this.prisma.tipo.delete({
                where: {
                    id: id,
                },
            });

            return `Tipo con ID '${result.id}' eliminado exitosamente.`;
        } catch (error: any) {
            throw new Error(`Error al intentar borrar el tipo con ID '${id}': ${error.message}`);
        }
    }

    async getAll() {
        try {
            return await this.prisma.tipo.findMany()
        } catch (error:any) {
            return error
        }


    }
    async  editDocumento({ nombre, id }: Documento): Promise<Documento | null> {
        try {
          const updatedDocumento = await this.prisma.tipo.update({
            where: {
              id: id,
            },
            data: {
              nombre: nombre,
            },
          });

          return updatedDocumento;
        } catch (error:any) {
          return error;
        }
      }



}

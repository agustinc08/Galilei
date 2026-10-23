import { Injectable } from '@nestjs/common';
import { prisma } from './../../prisma/instance';

@Injectable()
export class DependenciaService {


    async getAll() {
        try {
            const result = await prisma.dependencia.findMany({
                orderBy: {
                    descripcion: 'asc' // Orden ascendente por la columna 'descripcion'
                }
            });
            return result;
        } catch (error) {
            return error;
        } finally {
            await prisma.$disconnect();
        }
    }

}

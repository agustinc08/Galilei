import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { EventosConsultaService } from '../estadisticas/eventos-consulta.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FavoritosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventosConsultaService: EventosConsultaService,
  ) {}

  async findAll(usuarioId: number) {
    const data = await this.prisma.favorito.findMany({
      where: { usuarioId },
      orderBy: { createdAt: 'desc' },
      include: {
        sentencia: {
          include: {
            _count: {
              select: { sumarios: true, archivosPdf: true },
            },
          },
        },
      },
    });

    return { data };
  }

  async add(usuarioId: number, sentenciaId: number) {
    try {
      const favorito = await this.prisma.favorito.create({
        data: { usuarioId, sentenciaId },
        include: {
          sentencia: true,
        },
      });

      this.eventosConsultaService.trackSafe({
        tipoEvento: 'favorite_add',
        usuarioId,
        sentenciaId,
      });

      return { data: favorito };
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('La sentencia ya esta en favoritos');
        }
        if (error.code === 'P2003') {
          throw new NotFoundException('La sentencia no existe');
        }
      }

      throw error;
    }
  }

  async remove(usuarioId: number, sentenciaId: number) {
    await this.prisma.favorito.deleteMany({
      where: { usuarioId, sentenciaId },
    });

    this.eventosConsultaService.trackSafe({
      tipoEvento: 'favorite_remove',
      usuarioId,
      sentenciaId,
    });

    return { data: { deleted: true } };
  }
}

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { LogsService } from '../logs/logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCitaFalloDto } from './dto/create-cita-fallo.dto';
import { UpdateCitaFalloDto } from './dto/update-cita-fallo.dto';
import { detectCitasInText } from './utils/cita-patterns';

@Injectable()
export class CitasFalloService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logsService: LogsService,
  ) {}

  private get client() {
    return this.prisma as PrismaClient;
  }

  async findBySentencia(sentenciaId: number, onlyConfirmed = false) {
    await this.ensureSentenciaExists(sentenciaId);

    const data = await this.client.citaFallo.findMany({
      where: {
        sentenciaId,
        ...(onlyConfirmed && { confirmada: true }),
      },
      orderBy: [{ confirmada: 'desc' }, { createdAt: 'desc' }],
    });

    return { data };
  }

  async create(sentenciaId: number, dto: CreateCitaFalloDto, usuarioId?: number) {
    await this.ensureSentenciaExists(sentenciaId);

    try {
      const data = await this.client.citaFallo.create({
        data: {
          sentenciaId,
          tipo: dto.tipo.trim().toUpperCase(),
          referencia: dto.referencia.trim(),
          textoOriginal: dto.textoOriginal?.trim() || null,
          contexto: dto.contexto?.trim() || null,
          pagina: dto.pagina ?? null,
          confirmada: dto.confirmada ?? true,
          creadaManual: true,
          createdById: usuarioId ?? null,
          updatedById: usuarioId ?? null,
        },
      });

      if (usuarioId) {
        await this.logsService.registrarAccion({
          usuarioId,
          entidad: 'CITA',
          entidadId: data.id,
          accion: 'CREATE',
          descripcion: 'Creó cita manual',
          datosDespues: data,
        });
      }

      return { data };
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async update(id: number, dto: UpdateCitaFalloDto, usuarioId?: number) {
    await this.ensureExists(id);
    const before = await this.client.citaFallo.findUnique({ where: { id } });

    try {
      const data = await this.client.citaFallo.update({
        where: { id },
        data: {
          ...(dto.tipo !== undefined && { tipo: dto.tipo.trim().toUpperCase() }),
          ...(dto.referencia !== undefined && {
            referencia: dto.referencia.trim(),
          }),
          ...(dto.textoOriginal !== undefined && {
            textoOriginal: dto.textoOriginal?.trim() || null,
          }),
          ...(dto.contexto !== undefined && {
            contexto: dto.contexto?.trim() || null,
          }),
          ...(dto.pagina !== undefined && { pagina: dto.pagina }),
          ...(dto.confirmada !== undefined && { confirmada: dto.confirmada }),
          updatedById: usuarioId ?? null,
        },
      });

      if (usuarioId) {
        const accion =
          dto.confirmada === true && before && !before.confirmada
            ? 'CONFIRMAR'
            : 'UPDATE';
        await this.logsService.registrarAccion({
          usuarioId,
          entidad: 'CITA',
          entidadId: id,
          accion,
          descripcion:
            accion === 'CONFIRMAR' ? 'Confirmó cita detectada' : 'Editó cita',
          datosAntes: before,
          datosDespues: data,
        });
      }

      return { data };
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async remove(id: number, usuarioId?: number) {
    await this.ensureExists(id);
    const before = await this.client.citaFallo.findUnique({ where: { id } });
    await this.client.citaFallo.delete({ where: { id } });

    if (usuarioId) {
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'CITA',
        entidadId: id,
        accion: 'DELETE',
        descripcion: 'Eliminó cita',
        datosAntes: before,
      });
    }

    return { data: { deleted: true } };
  }

  async detectar(sentenciaId: number, usuarioId?: number) {
    const sentencia = await this.client.sentencia.findUnique({
      where: { id: sentenciaId },
      include: {
        sumarios: {
          orderBy: { id: 'asc' },
        },
        citasFallo: true,
      },
    });

    if (!sentencia) {
      throw new NotFoundException('Sentencia no encontrada');
    }

    // TODO: cuando exista extraccion de texto por pagina desde PDF, usarla
    // como fuente principal de deteccion y preservar la pagina de origen.
    const sourceText = [
      sentencia.resumenIa,
      sentencia.resena,
      sentencia.textoBusqueda,
      sentencia.objeto,
      sentencia.magistrados,
      sentencia.actor,
      sentencia.demandado,
      sentencia.expediente,
      sentencia.numeroSentencia,
      ...sentencia.sumarios.map((sumario) =>
        [sumario.tema, sumario.texto, sumario.resumenBusqueda, sumario.textoBusqueda]
          .filter(Boolean)
          .join('\n'),
      ),
    ]
      .filter(Boolean)
      .join('\n\n');

    const detected = detectCitasInText(sourceText);
    const existingKeys = new Set(
      sentencia.citasFallo.map((item) => `${item.tipo}::${item.referencia}`),
    );

    const toCreate = detected.filter(
      (item) => !existingKeys.has(`${item.tipo}::${item.referencia}`),
    );

    if (toCreate.length > 0) {
      await this.client.citaFallo.createMany({
        data: toCreate.map((item) => ({
          sentenciaId,
          tipo: item.tipo,
          referencia: item.referencia,
          textoOriginal: item.textoOriginal,
          contexto: item.contexto,
          pagina: item.pagina ?? null,
          confirmada: false,
          creadaManual: false,
          createdById: usuarioId ?? null,
          updatedById: usuarioId ?? null,
        })),
      });
    }

    if (usuarioId) {
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'CITA',
        entidadId: sentenciaId,
        accion: 'DETECTAR',
        descripcion: `Detectó citas automáticamente: ${toCreate.length} creadas`,
        datosDespues: {
          encontradas: detected.length,
          creadas: toCreate.length,
          duplicadas: detected.length - toCreate.length,
        },
      });
    }

    return {
      data: {
        encontradas: detected.length,
        creadas: toCreate.length,
        duplicadas: detected.length - toCreate.length,
        errores: 0,
      },
    };
  }

  private async ensureSentenciaExists(sentenciaId: number) {
    const sentencia = await this.prisma.sentencia.findUnique({
      where: { id: sentenciaId },
      select: { id: true },
    });

    if (!sentencia) {
      throw new NotFoundException('Sentencia no encontrada');
    }
  }

  private async ensureExists(id: number) {
    const cita = await this.client.citaFallo.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!cita) {
      throw new NotFoundException('Cita del fallo no encontrada');
    }
  }

  private handlePrismaError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('La cita ya existe para esta sentencia');
    }

    throw error;
  }
}

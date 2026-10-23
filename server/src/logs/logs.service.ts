import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryLogsDto } from './dto/query-logs.dto';

type RegistrarAccionInput = {
  usuarioId: number;
  entidad: string;
  entidadId?: number | null;
  accion: string;
  descripcion?: string;
  datosAntes?: unknown;
  datosDespues?: unknown;
};

type LogRow = {
  id: number;
  usuarioId: number;
  entidad: string;
  entidadId?: number | null;
  accion: string;
  descripcion?: string | null;
  datosAntes?: Record<string, unknown> | null;
  datosDespues?: Record<string, unknown> | null;
  createdAt: Date;
  usuario: {
    id: number;
    nombre: string;
    apellido?: string | null;
    email: string;
    rol: {
      nombre: string;
    };
  };
};

function sanitizeForLog(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item) ?? null) as Prisma.InputJsonValue;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'passwordHash')
      .map(([key, current]) => [key, sanitizeForLog(current) ?? null]);

    return Object.fromEntries(entries) as Prisma.InputJsonObject;
  }

  return String(value);
}

@Injectable()
export class LogsService {
  constructor(private readonly prisma: PrismaService) {}

  private get client() {
    return this.prisma as unknown as {
      accionLog: {
        create: (args: {
          data: {
            usuarioId: number;
            entidad: string;
            entidadId: number | null;
            accion: string;
            descripcion?: string;
            datosAntes?: Prisma.InputJsonValue;
            datosDespues?: Prisma.InputJsonValue;
          };
        }) => Promise<unknown>;
        findMany: (args: {
          where?: Record<string, unknown>;
          skip?: number;
          take?: number;
          orderBy?: Record<string, unknown>;
          include?: Record<string, unknown>;
        }) => Promise<unknown[]>;
        count: (args: { where?: Record<string, unknown> }) => Promise<number>;
        findUnique: (args: {
          where: { id: number };
          include?: Record<string, unknown>;
        }) => Promise<unknown | null>;
      };
      $transaction: (args: [Promise<unknown[]>, Promise<number>]) => Promise<[unknown[], number]>;
    };
  }

  async registrarAccion(input: RegistrarAccionInput) {
    await this.client.accionLog.create({
      data: {
        usuarioId: input.usuarioId,
        entidad: input.entidad,
        entidadId: input.entidadId ?? null,
        accion: input.accion,
        descripcion: input.descripcion,
        datosAntes: sanitizeForLog(input.datosAntes) as Prisma.InputJsonValue | undefined,
        datosDespues: sanitizeForLog(input.datosDespues) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async findAll(query: QueryLogsDto) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);
    const where = this.buildWhere(query);

    const [data, total] = await this.client.$transaction([
      this.client.accionLog.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          usuario: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              email: true,
              rol: { select: { nombre: true } },
            },
          },
        },
      }),
      this.client.accionLog.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        pageSize,
        pageCount: Math.ceil(total / pageSize),
      },
    };
  }

  async exportCsv(query: QueryLogsDto) {
    const rows = await this.client.accionLog.findMany({
      where: this.buildWhere(query),
      take: 5000,
      orderBy: { createdAt: 'desc' },
      include: { usuario: { select: { id: true, nombre: true, apellido: true, email: true, rol: { select: { nombre: true } } } } },
    }) as Array<Record<string, unknown>>;
    const columns = ['id', 'createdAt', 'usuario', 'email', 'rol', 'entidad', 'entidadId', 'accion', 'descripcion', 'datosAntes', 'datosDespues'];
    const lines = [columns.map(csvCell).join(','), ...rows.map((row) => {
      const user = row.usuario as { nombre?: string; apellido?: string | null; email?: string; rol?: { nombre?: string } } | undefined;
      const values = [row.id, row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt, [user?.nombre, user?.apellido].filter(Boolean).join(' '), user?.email, user?.rol?.nombre, row.entidad, row.entidadId, row.accion, row.descripcion, row.datosAntes, row.datosDespues];
      return values.map(csvCell).join(',');
    })];
    return `${lines.join('\r\n')}\r\n`;
  }

  private buildWhere(query: QueryLogsDto) {
    const documentFilter = query.documentId ? { OR: [
      { datosAntes: { path: ['documentId'], equals: query.documentId } },
      { datosDespues: { path: ['documentId'], equals: query.documentId } },
    ] } : undefined;
    return {
      ...(query.usuarioId && { usuarioId: query.usuarioId }),
      ...(query.entidad && { entidad: query.entidad }),
      ...(query.accion && { accion: query.accion }),
      ...(documentFilter ? { AND: [documentFilter] } : {}),
      ...((query.fechaDesde || query.fechaHasta) && {
        createdAt: {
          ...(query.fechaDesde && { gte: query.fechaDesde }),
          ...(query.fechaHasta && { lte: query.fechaHasta }),
        },
      }),
    };
  }

  async findOne(id: number) {
    const data = await this.client.accionLog.findUnique({
      where: { id },
      include: {
        usuario: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            email: true,
            rol: { select: { nombre: true } },
          },
        },
      },
    });

    if (!data) {
      throw new NotFoundException('Log de auditoria no encontrado');
    }

    return { data };
  }

  async findTimelineBySentencia(
    sentenciaId: number,
    order: 'asc' | 'desc' = 'desc',
  ) {
    const rows = (await this.client.accionLog.findMany({
      orderBy: { createdAt: order },
      include: {
        usuario: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            email: true,
            rol: { select: { nombre: true } },
          },
        },
      },
      take: 2000,
    })) as LogRow[];

    const data = rows.filter((row) => this.belongsToSentencia(row, sentenciaId));
    return { data };
  }

  private belongsToSentencia(row: LogRow, sentenciaId: number) {
    if (row.entidadId === sentenciaId && ['SENTENCIA', 'RESEÑA'].includes(row.entidad)) {
      return true;
    }

    const candidates = [row.datosAntes, row.datosDespues];
    return candidates.some((payload) => this.extractSentenciaId(payload) === sentenciaId);
  }

  private extractSentenciaId(payload?: Record<string, unknown> | null): number | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const direct = payload.sentenciaId;
    if (typeof direct === 'number') {
      return direct;
    }

    const nestedSentencia = payload.sentencia;
    if (nestedSentencia && typeof nestedSentencia === 'object') {
      const nestedId = (nestedSentencia as Record<string, unknown>).id;
      if (typeof nestedId === 'number') {
        return nestedId;
      }
    }

    return null;
  }
}

function csvCell(value: unknown) {
  const raw = value instanceof Date ? value.toISOString() : value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
  const safe = /^[=+@-]/u.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/gu, '""')}"`;
}

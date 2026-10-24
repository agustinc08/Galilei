import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsoStatsQueryDto } from './dto/uso-stats-query.dto';

type TrackEventInput = {
  tipoEvento: string;
  usuarioId?: number | null;
  sentenciaId?: number | null;
  metadata?: Prisma.InputJsonValue | Record<string, unknown>;
};

type EventoConsultaRow = {
  id: number;
  tipoEvento: string;
  usuarioId: number | null;
  sentenciaId: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

@Injectable()
export class EventosConsultaService {
  constructor(private readonly prisma: PrismaService) {}

  async track(input: TrackEventInput) {
    return this.prisma.eventoConsulta.create({
      data: {
        tipoEvento: input.tipoEvento,
        usuarioId: input.usuarioId ?? null,
        sentenciaId: input.sentenciaId ?? null,
        metadata:
          (input.metadata as Prisma.InputJsonValue | undefined) ?? undefined,
      },
    });
  }

  trackSafe(input: TrackEventInput) {
    void this.track(input).catch(() => undefined);
  }

  async countByTipo(tipoEvento: string, query?: UsoStatsQueryDto) {
    return this.prisma.eventoConsulta.count({
      where: this.buildWhere({
        ...query,
        tipoEvento,
      }),
    });
  }

  async topSentenciasByEvent(
    tipoEvento: string,
    take = 10,
    query?: UsoStatsQueryDto,
  ) {
    const grouped = await this.prisma.eventoConsulta.groupBy({
      by: ['sentenciaId'],
      where: {
        ...this.buildWhere({
          ...query,
          tipoEvento,
        }),
        sentenciaId: { not: null },
      },
      _count: { sentenciaId: true },
      orderBy: {
        _count: { sentenciaId: 'desc' },
      },
      take,
    });

    const sentenciaIds = grouped
      .map((item: { sentenciaId: number | null }) => item.sentenciaId)
      .filter((item: number | null): item is number => item !== null);

    if (sentenciaIds.length === 0) {
      return [];
    }

    const sentencias = await this.prisma.sentencia.findMany({
      where: { id: { in: sentenciaIds } },
      select: {
        id: true,
        numeroSentencia: true,
        caratula: true,
        sala: true,
        fecha: true,
        publicado: true,
        destacada: true,
      },
    });

    return grouped.map(
      (item: {
        sentenciaId: number | null;
        _count: { sentenciaId: number };
      }) => ({
        sentenciaId: item.sentenciaId,
        total: item._count.sentenciaId,
        sentencia:
          sentencias.find((sentencia) => sentencia.id === item.sentenciaId) ??
          null,
      }),
    );
  }

  async groupedByTipo(prefix?: string, query?: UsoStatsQueryDto) {
    const rows = await this.prisma.eventoConsulta.groupBy({
      by: ['tipoEvento'],
      where: {
        ...this.buildWhere(query),
        ...(prefix
          ? {
              tipoEvento: {
                startsWith: prefix,
              },
            }
          : {}),
      },
      _count: { tipoEvento: true },
      orderBy: {
        _count: { tipoEvento: 'desc' },
      },
    });

    return rows.map(
      (row: { tipoEvento: string; _count: { tipoEvento: number } }) => ({
        tipoEvento: row.tipoEvento,
        total: row._count.tipoEvento,
      }),
    );
  }

  async getEventos(query?: UsoStatsQueryDto) {
    const rows = await this.prisma.eventoConsulta.findMany({
      where: this.buildWhere(query),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        tipoEvento: true,
        usuarioId: true,
        sentenciaId: true,
        metadata: true,
        createdAt: true,
      },
      take: 5000,
    });

    return rows as EventoConsultaRow[];
  }

  private buildWhere(query?: UsoStatsQueryDto) {
    if (!query) {
      return undefined;
    }

    return {
      ...(query.tipoEvento && { tipoEvento: query.tipoEvento }),
      ...((query.fechaDesde || query.fechaHasta) && {
        createdAt: {
          ...(query.fechaDesde && { gte: query.fechaDesde }),
          ...(query.fechaHasta && { lte: query.fechaHasta }),
        },
      }),
    };
  }
}

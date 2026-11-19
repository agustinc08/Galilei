import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReporteProblemaDto } from './dto/create-reporte-problema.dto';
import { QueryReportesProblemaDto } from './dto/query-reportes-problema.dto';
import { UpdateReporteProblemaDto } from './dto/update-reporte-problema.dto';

const MAX_USER_REPORTS_PER_HOUR = 5;

function moduleFromRoute(route: string) {
  const pathname = route.toLocaleLowerCase('es-AR');
  if (
    /^\/(busqueda|consulta|fallos|sentencias|sumarios|jurisprudencia)(\/|$)/u.test(
      pathname,
    )
  )
    return 'Jurisprudencia';
  if (/^\/(spaces|mi-sala|workspace)(\/|$)/u.test(pathname))
    return 'Sala / Juzgado';
  if (/^\/(personal|documentos)(\/|$)/u.test(pathname)) return 'Mis documentos';
  if (/^\/colecciones(\/|$)/u.test(pathname)) return 'Colecciones';
  if (/^\/admin(\/|$)/u.test(pathname)) return 'Administración';
  if (/^\/(revision|citas-pendientes)(\/|$)/u.test(pathname)) return 'Revisión';
  if (/^\/perfil(\/|$)/u.test(pathname)) return 'Cuenta';
  return 'Galilei';
}

function releaseVersion() {
  const value =
    process.env.BJC_RELEASE_SHA ??
    process.env.BJC_RELEASE_VERSION ??
    process.env.npm_package_version;
  return value?.slice(0, 80) || 'unknown';
}

@Injectable()
export class ReportesProblemasService {
  constructor(private readonly prisma: PrismaService) {}

  async create(usuarioId: number, dto: CreateReporteProblemaDto) {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = await this.prisma.reporteProblema.count({
      where: { usuarioId, createdAt: { gte: since } },
    });
    if (recentCount >= MAX_USER_REPORTS_PER_HOUR) {
      throw new HttpException(
        'Alcanzaste el máximo de reportes por hora. Intentá más tarde.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const ruta = dto.ruta.split(/[?#]/u, 1)[0] || '/';
    if (!ruta.startsWith('/') || ruta.startsWith('//')) {
      throw new BadRequestException('La pantalla indicada no es válida.');
    }

    const data = await this.prisma.$transaction(async (tx) => {
      const report = await tx.reporteProblema.create({
        data: {
          usuarioId,
          tipo: dto.tipo,
          descripcion: dto.descripcion,
          ruta,
          accion: dto.accion || null,
          modulo: moduleFromRoute(ruta),
          version: releaseVersion(),
          errorId: dto.errorId || null,
        },
        select: {
          id: true,
          tipo: true,
          ruta: true,
          modulo: true,
          estado: true,
          prioridad: true,
          createdAt: true,
        },
      });
      await tx.accionLog.create({
        data: {
          usuarioId,
          entidad: 'ReporteProblema',
          entidadId: report.id,
          accion: 'REPORT_CREATE',
          descripcion: 'Reporte de problema creado',
          datosDespues: {
            tipo: report.tipo,
            ruta: report.ruta,
            modulo: report.modulo,
          } satisfies Prisma.InputJsonObject,
        },
      });
      return report;
    });
    return { data };
  }

  async findAll(query: QueryReportesProblemaDto) {
    const where = {
      ...(query.estado && { estado: query.estado }),
      ...(query.prioridad && { prioridad: query.prioridad }),
    };
    const skip = (query.page - 1) * query.pageSize;
    const [total, data] = await Promise.all([
      this.prisma.reporteProblema.count({ where }),
      this.prisma.reporteProblema.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: query.pageSize,
        include: {
          usuario: {
            select: { id: true, nombre: true, apellido: true, email: true },
          },
          duplicadoDe: { select: { id: true, estado: true, prioridad: true } },
          duplicados: { select: { id: true, createdAt: true } },
        },
      }),
    ]);
    return {
      data,
      meta: {
        total,
        page: query.page,
        pageSize: query.pageSize,
        pageCount: Math.ceil(total / query.pageSize),
      },
    };
  }

  async update(id: number, actorId: number, dto: UpdateReporteProblemaDto) {
    const data = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.reporteProblema.findUnique({
        where: { id },
        select: {
          id: true,
          estado: true,
          prioridad: true,
          duplicadoDeId: true,
        },
      });
      if (!existing) throw new NotFoundException('Reporte no encontrado.');

      if (dto.duplicadoDeId !== undefined && dto.duplicadoDeId !== null) {
        if (dto.duplicadoDeId >= id) {
          throw new BadRequestException(
            'Vinculá el reporte con un reporte original anterior.',
          );
        }
        const original = await tx.reporteProblema.findUnique({
          where: { id: dto.duplicadoDeId },
          select: { id: true, duplicadoDeId: true },
        });
        if (!original || original.duplicadoDeId !== null) {
          throw new BadRequestException(
            'El reporte relacionado debe existir y ser un reporte original.',
          );
        }
      }

      const updated = await tx.reporteProblema.update({
        where: { id },
        data: {
          ...(dto.estado !== undefined && { estado: dto.estado }),
          ...(dto.prioridad !== undefined && { prioridad: dto.prioridad }),
          ...(dto.notasAdmin !== undefined && {
            notasAdmin: dto.notasAdmin || null,
          }),
          ...(dto.duplicadoDeId !== undefined && {
            duplicadoDeId: dto.duplicadoDeId,
          }),
        },
        include: {
          usuario: {
            select: { id: true, nombre: true, apellido: true, email: true },
          },
          duplicadoDe: { select: { id: true, estado: true, prioridad: true } },
          duplicados: { select: { id: true, createdAt: true } },
        },
      });
      await tx.accionLog.create({
        data: {
          usuarioId: actorId,
          entidad: 'ReporteProblema',
          entidadId: id,
          accion: 'REPORT_UPDATE',
          descripcion: 'Seguimiento del reporte actualizado',
          datosAntes: {
            estado: existing.estado,
            prioridad: existing.prioridad,
            duplicadoDeId: existing.duplicadoDeId,
          } satisfies Prisma.InputJsonObject,
          datosDespues: {
            estado: updated.estado,
            prioridad: updated.prioridad,
            duplicadoDeId: updated.duplicadoDeId,
          } satisfies Prisma.InputJsonObject,
        },
      });
      return updated;
    });
    return { data };
  }
}

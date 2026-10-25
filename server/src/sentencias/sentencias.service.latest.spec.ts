import type { CatalogosService } from '../catalogos/catalogos.service';
import type { EventosConsultaService } from '../estadisticas/eventos-consulta.service';
import type { LogsService } from '../logs/logs.service';
import type { PrismaService } from '../prisma/prisma.service';
import { SentenciasService } from './sentencias.service';

describe('SentenciasService.findLatestByDecisionDate', () => {
  it('uses public active judgments with a decision date and a bounded date order', async () => {
    const prisma = {
      sentencia: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new SentenciasService(
      prisma as unknown as PrismaService,
      {} as CatalogosService,
      {} as EventosConsultaService,
      {} as LogsService,
    );

    await service.findLatestByDecisionDate(100);

    expect(prisma.sentencia.findMany).toHaveBeenCalledWith({
      where: { publicado: true, activo: true, fecha: { not: null } },
      orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
      take: 20,
      select: {
        id: true,
        slugPublico: true,
        caratula: true,
        expediente: true,
        sala: true,
        fecha: true,
        numeroSentencia: true,
      },
    });
  });
});

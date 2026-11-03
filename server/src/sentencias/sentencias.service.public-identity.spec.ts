import { NotFoundException } from '@nestjs/common';
import type { CatalogosService } from '../catalogos/catalogos.service';
import type { EventosConsultaService } from '../estadisticas/eventos-consulta.service';
import type { LogsService } from '../logs/logs.service';
import type { PrismaService } from '../prisma/prisma.service';
import { SentenciasService } from './sentencias.service';

function makeService() {
  const prisma = {
    sentencia: { findFirst: jest.fn() },
  };
  const service = new SentenciasService(
    prisma as unknown as PrismaService,
    {} as CatalogosService,
    {} as EventosConsultaService,
    {} as LogsService,
  );
  return { service, prisma };
}

describe('SentenciasService.getPublicIdentity', () => {
  it.each([
    { identifier: 'public-slug', id: 7 },
    { identifier: '7', id: 7 },
  ])(
    'resolves public identifier $identifier using the shared publication filter',
    async ({ identifier, id }) => {
      const { service, prisma } = makeService();
      prisma.sentencia.findFirst.mockResolvedValue({
        id,
        slugPublico: identifier === '7' ? null : identifier,
      });

      await expect(service.getPublicIdentity(identifier)).resolves.toEqual({
        id,
        slugPublico: identifier === '7' ? null : identifier,
      });
      expect(prisma.sentencia.findFirst).toHaveBeenCalledWith({
        where: {
          publicado: true,
          activo: true,
          OR: [
            { slugPublico: identifier },
            ...(identifier === '7' ? [{ id: 7 }] : []),
          ],
        },
        select: { id: true, slugPublico: true },
      });
    },
  );

  it.each(['missing-slug', '999999'])(
    'returns 404 for inaccessible public identifier %s',
    async (identifier) => {
      const { service, prisma } = makeService();
      prisma.sentencia.findFirst.mockResolvedValue(null);

      await expect(
        service.getPublicIdentity(identifier),
      ).rejects.toBeInstanceOf(NotFoundException);
      const call = prisma.sentencia.findFirst.mock.calls[0] as unknown as [
        { where: Record<string, unknown> },
      ];
      expect(call[0].where).toMatchObject({ publicado: true, activo: true });
    },
  );
});

import { LogsService } from './logs.service';

describe('LogsService', () => {
  it('filters audit rows by document in before/after payloads and exports safe CSV', async () => {
    const row = {
      id: 7,
      createdAt: new Date('2026-10-08T12:00:00.000Z'),
      usuarioId: 4,
      usuario: {
        nombre: 'Ana',
        apellido: 'Civil',
        email: 'ana@example.test',
        rol: { nombre: 'ADMIN' },
      },
      entidad: 'CorpusDocument',
      entidadId: null,
      accion: 'REVIEWED',
      descripcion: '=HYPERLINK("x")',
      datosAntes: { documentId: 'doc-1' },
      datosDespues: { documentId: 'doc-1' },
    };
    const findMany = jest.fn().mockResolvedValue([row]);
    const prisma = {
      accionLog: {
        findMany,
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn(),
        findUnique: jest.fn(),
      },
      $transaction: jest.fn((operations: Promise<unknown>[]) =>
        Promise.all(operations),
      ),
    };
    const service = new LogsService(prisma as never);
    await service.findAll({ documentId: 'doc-1' });
    const findManyCalls = findMany.mock.calls as unknown as Array<
      [{ where: unknown; take?: number }]
    >;
    expect(findManyCalls[0]?.[0].where).toEqual({
      AND: [
        {
          OR: [
            { datosAntes: { path: ['documentId'], equals: 'doc-1' } },
            { datosDespues: { path: ['documentId'], equals: 'doc-1' } },
          ],
        },
      ],
    });
    const csv = await service.exportCsv({ documentId: 'doc-1' });
    expect(csv).toContain('"id","createdAt","usuario"');
    expect(csv).toContain('"\'=HYPERLINK(""x"")"');
    expect(findManyCalls.at(-1)?.[0].take).toBe(5000);
  });
});

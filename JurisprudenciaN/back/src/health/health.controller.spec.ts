import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('checks API, database, and storage readiness', async () => {
    const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([{ '?column?': 1 }]) } as never;
    const documents = { storageReady: jest.fn().mockResolvedValue(true) } as never;
    const controller = new HealthController(prisma, documents);
    const response = { status: jest.fn() } as never;

    await expect(controller.readiness(response)).resolves.toEqual({
      status: 'ok',
      service: 'jurisprudencia-back',
      checks: { api: 'ok', database: 'ok', storage: 'ok' },
    });
    expect((response as { status: jest.Mock }).status).toHaveBeenCalledWith(200);
  });
});

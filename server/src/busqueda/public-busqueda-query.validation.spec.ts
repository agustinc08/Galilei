import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import {
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_QUERY_TOO_LONG_MESSAGE,
} from './search-query-constraints';
import { BusquedaService } from './busqueda.service';
import { PublicBusquedaController } from './busqueda.controller';

describe('Public Search query validation boundary', () => {
  it('returns a stable 400 before calling Search for a query over the limit', async () => {
    const search = jest.fn();
    const moduleRef = await Test.createTestingModule({
      controllers: [PublicBusquedaController],
      providers: [
        {
          provide: BusquedaService,
          useValue: { federatedSearch: search },
        },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();

    try {
      const response = await request(app.getHttpServer() as Server)
        .get('/public/busqueda')
        .query({ q: 'x'.repeat(SEARCH_QUERY_MAX_LENGTH + 1) });

      expect(response.status).toBe(400);
      const payload = response.body as { message: string[] };
      expect(payload.message).toContain(SEARCH_QUERY_TOO_LONG_MESSAGE);
      expect(search).not.toHaveBeenCalled();
    } finally {
      await app.close();
      await moduleRef.close();
    }
  });
});

import { parseSearchQuery } from '../utils/search-parser';
import { PostgresJurisprudenciaSearchAdapter } from './postgres-jurisprudencia-search.adapter';

describe('PostgresJurisprudenciaSearchAdapter result highlights', () => {
  it('returns a bounded summary highlight when the match is beyond the result snippet', async () => {
    const adapter = new PostgresJurisprudenciaSearchAdapter(
      'postgresql://bjc_dev:test@127.0.0.1:55432/buscador_juridico_civil_dev',
      'set-algebra-v2',
    );
    const pool = (
      adapter as unknown as {
        pool: {
          query: (...args: unknown[]) => unknown;
          end: () => Promise<void>;
        };
      }
    ).pool;
    const summary = `${'contexto '.repeat(45)}responsabilidad civil y reparación integral`;
    jest.spyOn(pool, 'query').mockResolvedValueOnce({
      rows: [
        {
          id: 9,
          slugPublico: 'sentencia-prueba',
          numeroSentencia: '9/2026',
          tipoFallo: null,
          sala: null,
          fecha: null,
          expediente: null,
          tribunalOrigen: null,
          actor: null,
          actorPublico: null,
          demandado: null,
          demandadoPublico: null,
          anonimizado: false,
          objeto: null,
          magistrados: null,
          caratula: 'Caso de prueba',
          textoBusqueda: null,
          textoBusquedaNormalizado: '',
          sumariosSearchText: summary,
          sumarioCount: '1',
          publicado: true,
          activo: true,
          estadoCarga: 'PUBLICADA',
          archivosPdf: [],
        },
      ],
      rowCount: 1,
    } as never);

    try {
      const result = await adapter.hydrateSentenciaCandidates(
        ['SENTENCIA:9'],
        parseSearchQuery('responsabilidad'),
        {
          visibility: 'PUBLIC',
          dialect: 'modern',
          publicationPolicy: 'published-active-only',
          page: 1,
          pageSize: 10,
        },
      );
      const highlights = result.results[0].highlights ?? [];

      expect(result.results[0].snippet).not.toContain('responsabilidad');
      expect(highlights).toHaveLength(1);
      expect(highlights[0].campo).toBe('tema');
      expect(highlights[0].texto).toContain('<mark>responsabilidad</mark>');
      expect(highlights[0].texto.length).toBeLessThan(180);
      expect(result.results[0].metadata).not.toHaveProperty('tema');
    } finally {
      await adapter.close();
    }
  });
});

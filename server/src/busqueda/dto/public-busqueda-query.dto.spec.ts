import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_QUERY_TOO_LONG_MESSAGE,
} from '../search-query-constraints';
import { PublicBusquedaQueryDto } from './public-busqueda-query.dto';

describe('PublicBusquedaQueryDto sort whitelist', () => {
  it.each(['sala', 'numeroSentencia'] as const)(
    'accepts both documented directions for %s',
    (sortBy) => {
      for (const sortOrder of ['asc', 'desc'] as const) {
        const dto = plainToInstance(PublicBusquedaQueryDto, {
          sortBy,
          sortOrder,
        });
        expect(validateSync(dto)).toEqual([]);
      }
    },
  );

  it('continues rejecting arbitrary sort fields and directions', () => {
    const dto = plainToInstance(PublicBusquedaQueryDto, {
      sortBy: 'unmappedField',
      sortOrder: 'sideways',
    });

    expect(validateSync(dto).map((error) => error.property)).toEqual(
      expect.arrayContaining(['sortBy', 'sortOrder']),
    );
  });
});

describe('PublicBusquedaQueryDto query length', () => {
  it.each([
    ['empty', ''],
    ['one character', 'x'],
    ['ordinary legal query', 'responsabilidad civil y daño moral'],
    ['spaces only', '   '],
    ['Unicode', 'jurisprudencia 東京'],
    ['accented Spanish', 'daño médico, lesión y reparación'],
    ['ñ', 'año y niñez'],
    ['emoji input', '⚖️📄'],
    ['exact maximum', 'x'.repeat(SEARCH_QUERY_MAX_LENGTH)],
    ['maximum emoji code units', '⚖️'.repeat(SEARCH_QUERY_MAX_LENGTH / 2)],
  ])('accepts %s', (_label, q) => {
    const dto = plainToInstance(PublicBusquedaQueryDto, { q });

    expect(validateSync(dto)).toEqual([]);
  });

  it.each([
    ['maximum plus one', SEARCH_QUERY_MAX_LENGTH + 1],
    ['the observed long query', 1024],
    ['a very long pasted document', 100_000],
  ])('rejects %s before a search can be issued', (_label, length) => {
    const dto = plainToInstance(PublicBusquedaQueryDto, {
      q: 'x'.repeat(length),
    });

    const error = validateSync(dto).find((item) => item.property === 'q');
    expect(error?.constraints?.maxLength).toBe(SEARCH_QUERY_TOO_LONG_MESSAGE);
  });
});

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
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

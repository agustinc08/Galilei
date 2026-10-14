import {
  mimeTypesForCorpusTypes,
  validateCorpusTypes,
  validateSearchDateRange,
} from './search-filters';

describe('Corpus Search filters', () => {
  it('accepts calendar dates inclusively and rejects invalid or reversed ranges', () => {
    expect(validateSearchDateRange('2025-01-01', '2025-12-31')).toEqual({
      dateFrom: '2025-01-01',
      dateTo: '2025-12-31',
    });
    expect(validateSearchDateRange(undefined, '2025-12-31')).toEqual({
      dateTo: '2025-12-31',
    });
    expect(() => validateSearchDateRange('2025-02-29', undefined)).toThrow();
    expect(() => validateSearchDateRange('2026-01-01', '2025-12-31')).toThrow();
    expect(() => validateSearchDateRange('2025-1-01', undefined)).toThrow();
  });

  it('limits file type filters to latest-file MIME categories PDF and TXT', () => {
    expect(validateCorpusTypes('pdf')).toEqual(['PDF']);
    expect(validateCorpusTypes(['TXT', 'PDF', 'TXT'])).toEqual(['TXT', 'PDF']);
    expect(mimeTypesForCorpusTypes(['PDF', 'TXT'])).toEqual([
      'application/pdf',
      'text/plain',
    ]);
    expect(() => validateCorpusTypes('DOCX')).toThrow();
  });
});

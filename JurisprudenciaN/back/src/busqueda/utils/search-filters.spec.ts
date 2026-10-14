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

  it('limits file type filters to detected format MIME categories', () => {
    expect(validateCorpusTypes('pdf')).toEqual(['PDF']);
    expect(validateCorpusTypes(['TXT', 'DOCX', 'RTF', 'PDF', 'TXT'])).toEqual([
      'TXT',
      'DOCX',
      'RTF',
      'PDF',
    ]);
    expect(
      mimeTypesForCorpusTypes(['PDF', 'TXT', 'RTF', 'DOC', 'DOCX', 'ODT']),
    ).toEqual([
      'application/pdf',
      'text/plain',
      'application/rtf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.oasis.opendocument.text',
    ]);
    expect(() => validateCorpusTypes('XLSX')).toThrow();
  });
});

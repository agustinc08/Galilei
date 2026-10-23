import { sanitizeExtraction } from './corpus-ingestion.service';

describe('sanitizeExtraction', () => {
  it('removes PostgreSQL-incompatible NUL characters from text and page rows', () => {
    const output = sanitizeExtraction({
      text: 'fallo\u0000 civil',
      pages: [{ pageNumber: 1, text: 'responsabilidad\u0000 civil' }],
      extractor: 'test',
    });
    expect(output.text).toBe('fallo civil');
    expect(output.pages[0].text).toBe('responsabilidad civil');
    expect(output.extractor).toBe('test');
  });
});

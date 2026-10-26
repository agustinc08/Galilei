import {
  expedienteEquivalentValues,
  normalizeExpediente,
} from './expediente-normalizer';

describe('conservative expediente identity', () => {
  it('equates case, repeated whitespace, and slash/hyphen separators', () => {
    expect(normalizeExpediente('  expte.   123 / 2020 ')).toBe(
      normalizeExpediente('EXPTE. 123-2020'),
    );
    expect(expedienteEquivalentValues('123/2020')).toContain('123-2020');
    expect(expedienteEquivalentValues('CIV 123/2020')).toContain(
      'CIV  123/2020',
    );
  });

  it('keeps a different year distinct and does not infer a yearless docket', () => {
    expect(normalizeExpediente('123/2020')).not.toBe(
      normalizeExpediente('123/2021'),
    );
    expect(normalizeExpediente('123')).toBeNull();
    expect(normalizeExpediente('123 2020')).toBeNull();
    expect(normalizeExpediente(null)).toBeNull();
  });

  it('preserves meaningful docket identifiers rather than matching their shared numbers', () => {
    expect(normalizeExpediente('CIV 123/2020')).not.toBe(
      normalizeExpediente('LAB 123/2020'),
    );
    expect(normalizeExpediente('123/2020-A')).toBeNull();
  });
});

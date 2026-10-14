import {
  isUsableOcrPage,
  parseTesseractTsv,
  LocalPdfOcrProcessor,
  type RuntimeConfig,
} from './document-local-processors';

describe('local OCR parsing and quality gate', () => {
  it('keeps words on the same TSV line and averages word confidence', () => {
    const tsv = [
      'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
      '5\t1\t1\t1\t1\t1\t0\t0\t50\t20\t92.0\tResponsabilidad',
      '5\t1\t1\t1\t1\t2\t55\t0\t30\t20\t80.0\tcivil',
      '5\t1\t1\t1\t2\t1\t0\t30\t40\t20\t70.0\tCórdoba',
    ].join('\n');

    expect(parseTesseractTsv(tsv)).toEqual({
      text: 'Responsabilidad civil\nCórdoba',
      confidence: (92 + 80 + 70) / 3,
    });
  });

  it('accepts readable Spanish and rejects empty, garbage, or low-confidence OCR', () => {
    expect(isUsableOcrPage('Daño moral en Córdoba', 83)).toBe(true);
    expect(isUsableOcrPage('', 95)).toBe(false);
    expect(isUsableOcrPage('@@@###!!!', 85)).toBe(false);
    expect(isUsableOcrPage('Texto suficiente pero dudoso', 19.9)).toBe(false);
    expect(isUsableOcrPage('Sí', 59)).toBe(false);
    expect(isUsableOcrPage('Sí', 60)).toBe(true);
  });

  it('fingerprints OCR by file SHA, normalized pages and processor settings, not filename', () => {
    const config: RuntimeConfig = {
      enginePath: null,
      rendererPath: null,
      tessdataDir: null,
      officePath: null,
      languages: ['spa'],
      dpi: 250,
      timeoutMs: 90_000,
      minFreeDiskBytes: 512 * 1024 * 1024,
      maxPages: 2_000,
      tempDir: process.cwd(),
      enabled: true,
    };
    const processor = new LocalPdfOcrProcessor(config);
    const sha = 'a'.repeat(64);
    const original = processor.fingerprint(sha, [2, 1]);

    expect(processor.fingerprint(sha, [1, 2])).toBe(original);
    expect(processor.fingerprint('b'.repeat(64), [1, 2])).not.toBe(original);
    expect(processor.fingerprint(sha, [1, 2], 300)).not.toBe(original);
    expect(processor.fingerprint(sha, [1, 2], 250, ['spa', 'eng'])).not.toBe(
      original,
    );
  });
});

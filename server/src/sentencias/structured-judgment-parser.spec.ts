import { parseStructuredJudgment } from './structured-judgment-parser';

describe('parseStructuredJudgment', () => {
  it('recognizes corpus-observed major headings and maps 1-based PDF pages', () => {
    const sections = parseStructuredJudgment([
      { pageNumber: 1, text: 'VISTOS Y CONSIDERANDO:\nTexto de apertura.' },
      {
        pageNumber: 2,
        text: 'I.- SOBRE LA RESPONSABILIDAD.\nContenido del apartado.',
      },
      {
        pageNumber: 4,
        text: 'II.- DAÑO MORAL:\nContenido.\nRESUELVE:',
      },
    ]);

    expect(
      sections.map(({ type, label, pageStart, pageEnd }) => ({
        type,
        label,
        pageStart,
        pageEnd,
      })),
    ).toEqual([
      {
        type: 'VISTOS',
        label: 'Vistos y Considerando',
        pageStart: 1,
        pageEnd: 1,
      },
      {
        type: 'NUMBERED_SECTION',
        label: 'I · SOBRE LA RESPONSABILIDAD',
        pageStart: 2,
        pageEnd: null,
      },
      {
        type: 'NUMBERED_SECTION',
        label: 'II · DAÑO MORAL',
        pageStart: 4,
        pageEnd: 4,
      },
      {
        type: 'RESUELVE',
        label: 'Resolución',
        pageStart: 4,
        pageEnd: 4,
      },
    ]);
  });

  it('does not turn ordinary numbered prose into section navigation', () => {
    const sections = parseStructuredJudgment([
      {
        pageNumber: 1,
        text: 'I. La sentencia de primera instancia hizo lugar a la demanda.\n2. El monto fue apelado.',
      },
    ]);
    expect(sections).toEqual([]);
  });

  it('does not invent outline entries for lowercase, inline, or weak headings', () => {
    const sections = parseStructuredJudgment([
      {
        pageNumber: 1,
        text: 'Considerando: se analiza la prueba.\nPor ello, corresponde hacer lugar.\nFUNDAMENTOS: se continúa en la misma línea.',
      },
    ]);
    expect(sections).toEqual([]);
  });

  it('retains source offsets and refuses to span missing page mappings', () => {
    const sections = parseStructuredJudgment([
      { pageNumber: 1, text: 'Portada\nVISTOS Y CONSIDERANDO:' },
      { pageNumber: 3, text: 'RESUELVE:' },
    ]);
    expect(sections).toMatchObject([
      {
        pageStart: 1,
        pageEnd: null,
        startOffset: 8,
        rawHeading: 'VISTOS Y CONSIDERANDO:',
      },
      { pageStart: 3, pageEnd: 3, rawHeading: 'RESUELVE:' },
    ]);
  });

  it('fails closed across extreme page gaps without iterating the page range', () => {
    const sections = parseStructuredJudgment([
      { pageNumber: 1, text: 'VISTOS:' },
      { pageNumber: 100_000, text: 'RESUELVE:' },
    ]);
    expect(sections).toMatchObject([
      { rawHeading: 'VISTOS:', pageStart: 1, pageEnd: null },
      { rawHeading: 'RESUELVE:', pageStart: 100_000, pageEnd: 100_000 },
    ]);
  });

  it('fails closed when the source page count or total text size exceeds bounds', () => {
    expect(
      parseStructuredJudgment(
        Array.from({ length: 10_001 }, (_, index) => ({
          pageNumber: index + 1,
          text: 'VISTOS:',
        })),
      ),
    ).toEqual([]);
    expect(
      parseStructuredJudgment(
        Array.from({ length: 11 }, (_, index) => ({
          pageNumber: index + 1,
          text: `VISTOS:\n${'x'.repeat(999_990)}`,
        })),
      ),
    ).toEqual([]);
  });

  it('preserves the combined Vistos y Considerando heading in the label', () => {
    const sections = parseStructuredJudgment([
      { pageNumber: 1, text: 'VISTOS Y CONSIDERANDO:\nApertura.' },
    ]);
    expect(sections[0]).toMatchObject({
      type: 'VISTOS',
      label: 'Vistos y Considerando',
      rawHeading: 'VISTOS Y CONSIDERANDO:',
    });
  });

  it('suppresses an identical page-top running heading on consecutive pages', () => {
    const sections = parseStructuredJudgment([
      { pageNumber: 1, text: 'RESUELVE:\nContenido.' },
      { pageNumber: 2, text: 'RESUELVE:\nContinúa el texto.' },
    ]);
    expect(sections).toHaveLength(1);
  });
});

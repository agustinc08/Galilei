import { CITATION_EVALUATION_SET } from './citation-evaluation-set';
import { extractIdentifiedCitations } from './citation-extractor';

describe('explicit legal citation extraction', () => {
  it('extracts year-qualified case identifiers, preserves provenance text, and deduplicates repeats', () => {
    expect(
      extractIdentifiedCitations(CITATION_EVALUATION_SET[0].text),
    ).toMatchObject([
      {
        rawCitation: 'Expte. N° 1234/2020',
        identifier: '1234/2020',
        normalizedIdentifier: '1234/2020',
        identifierType: 'EXPEDIENTE',
      },
    ]);
    expect(
      extractIdentifiedCitations(CITATION_EVALUATION_SET[3].text),
    ).toHaveLength(1);
  });

  it('does not infer citations from dates, law numbers, ambiguous references, or incomplete identifiers', () => {
    for (const item of CITATION_EVALUATION_SET.slice(4)) {
      expect(extractIdentifiedCitations(item.text)).toEqual([]);
    }
  });

  it('does not treat expert measurements as expediente citations', () => {
    expect(
      extractIdentifiedCitations(
        'El experto estimó que circulaba a 30/40 km/h.',
      ),
    ).toEqual([]);
  });

  it('recognizes expediente labels only at a word boundary', () => {
    expect(
      extractIdentifiedCitations(
        'Exp. 9/2020; Expte 10/2021; Expediente 11/2022',
      ),
    ).toMatchObject([
      { identifier: '9/2020', identifierType: 'EXPEDIENTE' },
      { identifier: '10/2021', identifierType: 'EXPEDIENTE' },
      { identifier: '11/2022', identifierType: 'EXPEDIENTE' },
    ]);
  });

  it('excludes identifiers belonging to the source judgment', () => {
    expect(
      extractIdentifiedCitations(
        'Expte. CIV 101/2024; Expte. 202/2025; Sentencia 88/2022',
        {
          expediente: 'QA CIV 101/2024',
          numeroSentencia: 'Sentencia 88/2022',
        },
      ),
    ).toMatchObject([{ identifier: '202/2025', identifierType: 'EXPEDIENTE' }]);
  });

  it('normalizes source identifiers across court prefixes and two-digit years', () => {
    expect(
      extractIdentifiedCitations('Expte. nº CIV 28029/2017; Expte. 72.442/18', {
        expediente: '28029/17',
      }),
    ).toMatchObject([
      { identifier: '72.442/18', identifierType: 'EXPEDIENTE' },
    ]);
  });

  it('measures precision, recall, and unresolved cases on the inspectable sample', () => {
    let truePositive = 0;
    let falsePositive = 0;
    let falseNegative = 0;
    let unresolved = 0;
    for (const item of CITATION_EVALUATION_SET) {
      const predicted = extractIdentifiedCitations(item.text).map(
        (candidate) =>
          `${candidate.identifierType}:${candidate.normalizedIdentifier}`,
      );
      const gold = new Set<string>(item.gold);
      const actual = new Set(predicted);
      if (item.kind === 'ambiguous' || item.kind === 'incomplete')
        unresolved += 1;
      for (const value of actual) {
        if (gold.has(value)) truePositive += 1;
        else falsePositive += 1;
      }
      for (const value of gold) if (!actual.has(value)) falseNegative += 1;
    }
    expect({
      precision: truePositive / (truePositive + falsePositive),
      recall: truePositive / (truePositive + falseNegative),
      unresolved,
      cases: CITATION_EVALUATION_SET.length,
    }).toEqual({ precision: 1, recall: 1, unresolved: 2, cases: 8 });
  });
});

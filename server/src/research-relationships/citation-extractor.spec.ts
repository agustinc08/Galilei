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

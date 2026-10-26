import { readFileSync } from 'node:fs';
import {
  normalizeLegalIdentifier,
  parseArgentineCitationsV2,
  resolveCitationV2,
} from './citation-parser-v2';

type CitationGoldCase = {
  id: string;
  text: string;
  expectedFamily: string | null;
};

const citationGold = JSON.parse(
  readFileSync(
    new URL(
      './fixtures/argentine-citation-parser-v2.gold.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { version: string; cases: CitationGoldCase[] };

describe('Argentine citation parser v2', () => {
  it('includes the versioned 100-case gold set', () => {
    expect(citationGold.version).toBe('argentine-citation-parser-v2-gold-1');
    expect(citationGold.cases).toHaveLength(100);
  });

  it.each(citationGold.cases)('gold case $id', (item) => {
    const detected = parseArgentineCitationsV2([
      { pageNumber: 1, text: item.text },
    ]);
    expect(detected.map((candidate) => candidate.family)).toEqual(
      item.expectedFamily ? [item.expectedFamily] : [],
    );
  });
  it('preserves real-derived raw forms and source-page offsets', () => {
    const text =
      'Conf. CNCiv., Sala E, 3/4/96, LL, 1996-D-864; Expte. n° 69.397/2003; Fallos: 329:4944; CSJN, “Fallos”: 274:113; CSJN, Fallos, 282:193.';
    const citations = parseArgentineCitationsV2([
      { pageNumber: 8, text, textKind: 'NATIVE' },
    ]);
    const salaDate = citations.find(
      (item) => item.family === 'CNCIV_SALA_DATE',
    );
    expect(salaDate?.rawCitation).toBe('CNCiv., Sala E, 3/4/96');
    expect(salaDate?.sourcePage).toBe(8);
    expect(salaDate?.sourceStartOffset).toBe(text.indexOf('CNCiv'));
    expect(salaDate?.parsedFields.court).toBe('CNCiv');
    expect(salaDate?.parsedFields.chamber).toBe('E');
    expect(salaDate?.parsedFields.date).toBe('3/4/96');

    const expediente = citations.find(
      (item) => item.family === 'EXPEDIENTE_IDENTIFIER',
    );
    expect(expediente?.rawCitation).toBe('Expte. n° 69.397/2003');
    expect(expediente?.normalizedIdentifier).toBe('69397/2003');

    const fallos = citations.find((item) => item.family === 'CSJN_FALLOS');
    expect(fallos?.rawCitation).toBe('Fallos: 329:4944');
    expect(fallos?.parsedFields.fallosVolume).toBe(329);
    expect(fallos?.parsedFields.fallosPage).toBe(4944);
    expect(
      citations.find((item) => item.rawCitation === 'Fallos”: 274:113')?.family,
    ).toBe('CSJN_FALLOS');
    expect(
      citations.find((item) => item.rawCitation === 'Fallos, 282:193')?.family,
    ).toBe('CSJN_FALLOS');
  });

  it('classifies statutes separately and ignores dates, article numbers, amounts, and noise', () => {
    const citations = parseArgentineCitationsV2([
      {
        pageNumber: 1,
        text: 'El 12/03/2024 se aplicó el artículo 347 del CPCC y la ley 24.441. El monto fue $224.400; el perito midió 30/40 km/h.',
      },
    ]);
    expect(citations.map((item) => item.family)).toEqual([
      'STATUTE_REFERENCE',
      'STATUTE_REFERENCE',
    ]);
    expect(citations.every((item) => item.identifierType === null)).toBe(true);
  });

  it('retains 2-digit years without assigning a century', () => {
    expect(normalizeLegalIdentifier('Expte. 14.935/07')).toBe('14935/07');
    const citations = parseArgentineCitationsV2([
      { pageNumber: 2, text: 'Expte. N° 14.935/07' },
    ]);
    expect(citations[0]?.normalizedIdentifier).toBe('14935/07');
  });

  it('suppresses exact source self-identifiers and never resolves by first-row order', () => {
    const citations = parseArgentineCitationsV2(
      [{ pageNumber: 1, text: 'Expte. CIV 28029/2017' }],
      { expediente: '28029/2017' },
    );
    expect(citations).toHaveLength(1);
    expect(citations[0]?.family).toBe('CIVIL_EXPEDIENTE');
    const citation = citations[0];
    expect(citation?.resolutionOutcome).toBe('SELF_REFERENCE');
    expect(resolveCitationV2(citation, 1, [])).toMatchObject({
      outcome: 'SELF_REFERENCE',
      targetSentenceId: null,
    });

    const targetCitation = parseArgentineCitationsV2([
      { pageNumber: 1, text: 'Expte. 1234/2020' },
    ])[0];
    const targets = [
      { id: 2, expediente: '1.234/2020', publicado: true, activo: true },
      { id: 3, expediente: '1234/2020', publicado: true, activo: true },
    ];
    expect(resolveCitationV2(targetCitation, 1, targets)).toMatchObject({
      outcome: 'AMBIGUOUS',
      targetSentenceId: null,
      candidateTargetIds: [2, 3],
    });
  });

  it('accepts docket-shaped CSJN references but does not mislabel acordadas as cases', () => {
    const citations = parseArgentineCitationsV2([
      {
        pageNumber: 1,
        text: 'Acordada CSJN 2/2020; Acordadas C.S.J.N. 15/2013; CSJN 11/06/1998, Rep. ED 23-946; causa F. L. R. (CSJN 678/2013 (49-F)/CS1); SCBA, 14.04.1998, DJBA-155, 3588.',
      },
    ]);
    expect(
      citations.filter((item) => item.family === 'CSJN_CASE'),
    ).toHaveLength(1);
    expect(citations.find((item) => item.family === 'CSJN_CASE')).toMatchObject(
      {
        rawCitation: 'CSJN 678/2013 (49-F)/CS1',
        parsedFields: { court: 'CSJN', decisionNumber: '678/2013 (49-F)/CS1' },
      },
    );
    expect(
      citations.find(
        (item) =>
          item.family === 'OTHER_COURT' && item.parsedFields.court === 'SCBA',
      )?.rawCitation,
    ).toBe('SCBA');
    expect(
      citations.find((item) => item.family === 'CSJN_DECISION_DATE'),
    ).toMatchObject({
      rawCitation: 'CSJN 11/06/1998',
      parsedFields: { date: '1998-06-11' },
    });
    expect(citations.some((item) => item.rawCitation === 'CSJN 15/2013')).toBe(
      false,
    );
  });

  it('resolves only one exact published active identifier and exact optional metadata', () => {
    const citation = parseArgentineCitationsV2([
      { pageNumber: 3, text: 'Expte. 1.234/2020' },
    ])[0];
    expect(
      resolveCitationV2(citation, 1, [
        { id: 2, expediente: '1234/2020', publicado: true, activo: true },
        { id: 4, expediente: '1234/2020', publicado: false, activo: true },
      ]),
    ).toMatchObject({ outcome: 'RESOLVED_UNIQUE', targetSentenceId: 2 });
    expect(
      resolveCitationV2(citation, 1, [
        { id: 4, expediente: '1234/2020', publicado: false, activo: true },
      ]),
    ).toMatchObject({ outcome: 'UNRESOLVED', targetSentenceId: null });
  });

  it('fails closed for over-limit corpus text', () => {
    expect(
      parseArgentineCitationsV2([
        { pageNumber: 1, text: 'x'.repeat(1_000_001) },
      ]),
    ).toEqual([]);
  });

  it('handles dense repeated docket references without quadratic overlap scans', () => {
    const repetitions = 10_000;
    const text = Array.from(
      { length: repetitions },
      () => 'Expte. CIV 12345/2024',
    ).join('; ');
    const citations = parseArgentineCitationsV2([{ pageNumber: 1, text }]);
    expect(citations).toHaveLength(repetitions);
    expect(
      citations.every((citation) => citation.family === 'CIVIL_EXPEDIENTE'),
    ).toBe(true);
  });

  it('bounds near-limit malformed citation text without inventing matches', () => {
    const malformed = 'Expte. CIV 123456789012345/2024x; '.repeat(20_000);
    expect(malformed.length).toBeLessThan(1_000_000);
    expect(
      parseArgentineCitationsV2([{ pageNumber: 1, text: malformed }]),
    ).toEqual([]);
  });
});

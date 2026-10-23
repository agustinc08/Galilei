import { normalizeSearchText } from '../utils/search-normalizer';
import {
  lexicalTokens,
  phraseBigramSequence,
  phraseSequence,
} from './opensearch-mapping';

type Fixture = {
  name: string;
  document: string;
  phrase: string;
  expected: boolean;
};

const fixtures: Fixture[] = [
  { name: 'two words', document: 'a b c', phrase: 'a b', expected: true },
  {
    name: 'three-word contiguous',
    document: 'a b c',
    phrase: 'a b c',
    expected: true,
  },
  {
    name: 'intervening word',
    document: 'a b x b c',
    phrase: 'a b c',
    expected: false,
  },
  {
    name: 'separate occurrences',
    document: 'a b expediente x b c',
    phrase: 'a b c',
    expected: false,
  },
  {
    name: 'four-word contiguous',
    document: 'a b c d',
    phrase: 'a b c d',
    expected: true,
  },
  {
    name: 'interior three-word phrase',
    document: 'a b c d',
    phrase: 'b c d',
    expected: true,
  },
  {
    name: 'skipped token',
    document: 'a b c',
    phrase: 'a c',
    expected: false,
  },
  {
    name: 'repeated tokens',
    document: 'a a a',
    phrase: 'a a a',
    expected: true,
  },
  {
    name: 'repeated tokens cannot skip',
    document: 'a a x a a',
    phrase: 'a a a',
    expected: false,
  },
  {
    name: 'retained punctuation must match',
    document: 'a-b',
    phrase: 'a b',
    expected: false,
  },
  {
    name: 'retained punctuation exact',
    document: 'a-b',
    phrase: 'a-b',
    expected: true,
  },
  {
    name: 'punctuation and trailing separator',
    document: 'c/ s.a. expediente',
    phrase: 'c/ s.a.',
    expected: true,
  },
  {
    name: 'line boundary follows Galilei space normalization',
    document: 'a\nb',
    phrase: 'a b',
    expected: true,
  },
  {
    name: 'accent normalization',
    document: 'acción civil',
    phrase: 'accion civil',
    expected: true,
  },
  {
    name: 'enye remains distinct',
    document: 'niño civil',
    phrase: 'nino civil',
    expected: false,
  },
  {
    name: 'enye exact',
    document: 'niño civil',
    phrase: 'niño civil',
    expected: true,
  },
  {
    name: 'numbers stay lexical atoms',
    document: 'ley 123/2024 civil',
    phrase: '123/2024 civil',
    expected: true,
  },
  {
    name: 'large document phrase',
    document: `${'antecedente '.repeat(8000)}responsabilidad civil contractual${' cierre'.repeat(8000)}`,
    phrase: 'responsabilidad civil contractual',
    expected: true,
  },
  {
    name: 'long accepted phrase',
    document: `${Array.from({ length: 301 }, (_, i) => `palabra${i}`).join(' ')} final`,
    phrase: Array.from({ length: 301 }, (_, i) => `palabra${i}`).join(' '),
    expected: true,
  },
];

function containsContiguous(sequence: string, query: string): boolean {
  const tokens = sequence.split(' ').filter(Boolean);
  const wanted = query.split(' ').filter(Boolean);
  if (!wanted.length || wanted.length > tokens.length) return false;
  for (let start = 0; start <= tokens.length - wanted.length; start += 1) {
    if (wanted.every((token, offset) => tokens[start + offset] === token))
      return true;
  }
  return false;
}

function oldPhrasePathMatches(document: string, phrase: string): boolean {
  return containsContiguous(
    phraseSequence(normalizeSearchText(document)),
    phraseSequence(normalizeSearchText(phrase)),
  );
}

function bigramPathMatches(document: string, phrase: string): boolean {
  const normalizedPhrase = normalizeSearchText(phrase);
  const phraseAtoms = phraseSequence(normalizedPhrase)
    .split(' ')
    .filter(Boolean);
  const phraseWords = phraseAtoms.filter((atom) => atom.startsWith('w'));
  if (phraseWords.length === 1 && phraseAtoms.length === 1) {
    const normalizedDocument = normalizeSearchText(document);
    return lexicalTokens(normalizedDocument).includes(phraseWords[0].slice(1));
  }
  if (
    phraseWords.length < 2 ||
    !phraseAtoms[0]?.startsWith('w') ||
    !phraseAtoms[phraseAtoms.length - 1]?.startsWith('w')
  )
    return oldPhrasePathMatches(document, phrase);
  return containsContiguous(
    phraseBigramSequence(normalizeSearchText(document)),
    phraseBigramSequence(normalizedPhrase),
  );
}

describe('Galilei phrase bigram equivalence', () => {
  it.each(fixtures)('$name', ({ document, phrase, expected }) => {
    const reference = oldPhrasePathMatches(document, phrase);
    const actual = bigramPathMatches(document, phrase);
    expect(reference).toBe(expected);
    expect(actual).toBe(reference);
  });

  it('preserves field boundaries that are isolated by the product query', () => {
    const firstField = 'responsabilidad';
    const secondField = 'civil';
    expect(bigramPathMatches(firstField, 'responsabilidad civil')).toBe(false);
    expect(
      bigramPathMatches(
        `${firstField} ${secondField}`,
        'responsabilidad civil',
      ),
    ).toBe(true);
  });

  it('keeps a single quoted lexical word on the exact-token path', () => {
    expect(lexicalTokens(normalizeSearchText('civil')).includes('civil')).toBe(
      true,
    );
    expect(phraseBigramSequence('civil')).toBe('');
  });

  it('encodes one positional term per adjacent lexical pair', () => {
    expect(phraseBigramSequence(normalizeSearchText('a b c'))).toBe(
      'wa~s20~wb wb~s20~wc',
    );
    expect(phraseBigramSequence(normalizeSearchText('a-b c'))).toBe(
      'wa~s2d~wb wb~s20~wc',
    );
  });
});

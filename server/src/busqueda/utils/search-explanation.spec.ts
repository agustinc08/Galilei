import { parseSearchQuery } from './search-parser';
import { explainSearchQuery } from './search-explanation';

describe('explainSearchQuery', () => {
  it('explains an unquoted term as lexical prefix without changing the parser', () => {
    const parsed = parseSearchQuery('responsabilidad civil');
    const explanation = explainSearchQuery(parsed.root);
    expect(explanation.summary).toContain('desde el inicio de una palabra');
    expect(explanation.summary).toContain('Y');
  });

  it('explains a quoted phrase and a quoted single word from their parsed nodes', () => {
    expect(
      explainSearchQuery(parseSearchQuery('"responsabilidad civil"').root)
        .summary,
    ).toContain('frase exacta');
    expect(
      explainSearchQuery(parseSearchQuery('"daño"').root).summary,
    ).toContain('palabra completa');
  });

  it.each([
    ['civil%', 'comiencen'],
    ['%civil', 'terminen'],
    ['%civil%', 'cualquier posición'],
  ])('describes the supported wildcard %s', (query, expected) => {
    expect(explainSearchQuery(parseSearchQuery(query).root).summary).toContain(
      expected,
    );
  });

  it('keeps query terms and the ñ distinction in user-facing Spanish', () => {
    const result = explainSearchQuery(parseSearchQuery('daño -nino').root);
    expect(result.summary).toContain('daño');
    expect(result.summary).toContain('Excluye');
    expect(result.notes).toContain('ñ');
  });
});

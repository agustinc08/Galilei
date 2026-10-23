import { parseSearchQuery } from '../utils/search-parser';
import { buildSearchQueryDsl, translateSearchNode } from './search-dsl';

describe('OpenSearch Galilei DSL', () => {
  it('uses lexical-token prefix for normal terms and exact tokens for quoted words', () => {
    const prefix = translateSearchNode(parseSearchQuery('responsab').root);
    const exact = translateSearchNode(parseSearchQuery('"civil"').root);
    expect(prefix).toEqual({
      prefix: {
        lexicalTokens: { value: 'responsab', case_insensitive: false },
      },
    });
    expect(exact).toEqual({ term: { lexicalTokens: 'civil' } });
    expect(translateSearchNode(parseSearchQuery('civil').root, true)).toEqual({
      prefix: {
        publicLexicalTokens: { value: 'civil', case_insensitive: false },
      },
    });
  });

  it('uses exact adjacent atom pairs for positional phrases', () => {
    expect(
      translateSearchNode(parseSearchQuery('"falta de servicio"').root),
    ).toEqual({
      match_phrase: {
        phraseBigrams: {
          query: 'wfalta~s20~wde wde~s20~wservicio',
          slop: 0,
        },
      },
    });
    expect(translateSearchNode(parseSearchQuery('"c/ s.a."').root)).toEqual({
      match_phrase: {
        phraseSequence: {
          query: 'wc s2f s20 ws s2e wa s2e',
          slop: 0,
        },
      },
    });
    expect(
      translateSearchNode(parseSearchQuery('caratula:"c/ s.a."').root),
    ).toEqual({
      match_phrase: {
        'fields.caratulaPhrase': {
          query: 'wc s2f s20 ws s2e wa s2e',
          slop: 0,
        },
      },
    });
  });

  it('preserves explicit prefix, suffix and contains wildcard paths', () => {
    expect(translateSearchNode(parseSearchQuery('civil%').root)).toEqual({
      prefix: { lexicalTokens: { value: 'civil', case_insensitive: false } },
    });
    expect(translateSearchNode(parseSearchQuery('%civil').root)).toEqual({
      wildcard: { lexicalTokens: { value: '*civil', case_insensitive: false } },
    });
    expect(translateSearchNode(parseSearchQuery('%civil%').root)).toEqual({
      wildcard: {
        lexicalTokens: { value: '*civil*', case_insensitive: false },
      },
    });
  });

  it('translates boolean AST recursively and leaves text clauses scoring in query context', () => {
    const ast = parseSearchQuery('responsab + civil - penal').root;
    expect(translateSearchNode(ast)).toEqual({
      bool: {
        should: [
          {
            prefix: {
              lexicalTokens: { value: 'responsab', case_insensitive: false },
            },
          },
          {
            bool: {
              must: [
                {
                  prefix: {
                    lexicalTokens: { value: 'civil', case_insensitive: false },
                  },
                },
                {
                  bool: {
                    must: [{ match_all: {} }],
                    must_not: [
                      {
                        prefix: {
                          lexicalTokens: {
                            value: 'penal',
                            case_insensitive: false,
                          },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
        minimum_should_match: 1,
      },
    });

    const query = buildSearchQueryDsl(
      parseSearchQuery('civil'),
      {
        visibility: 'PUBLIC',
        dialect: 'modern',
        publicationPolicy: 'published-active-only',
        documentScope: { kind: 'WORKSPACE', workspaceId: 'ws-1', userId: 42 },
      },
      { source: 'JURISPRUDENCIA' },
    );
    const serialized = JSON.stringify(query);
    expect(serialized).toContain('"publicationStatus":"PUBLISHED"');
    expect(serialized).toContain('"sourceSystem"');
    expect(serialized).toContain(
      '"prefix":{"publicSearchScopeFields.sentencia.tokens":{"value":"civil","case_insensitive":false}}',
    );
    expect(serialized).not.toContain('"workspaceId"');
  });

  it('enforces workspace and personal ACL inside the Corpus query', () => {
    const workspace = buildSearchQueryDsl(
      parseSearchQuery('civil'),
      {
        visibility: 'INTERNAL',
        dialect: 'modern',
        publicationPolicy: 'legacy-active-only',
        documentScope: { kind: 'WORKSPACE', workspaceId: 'ws-1', userId: 42 },
      },
      { source: 'CORPUS' },
    );
    const personal = buildSearchQueryDsl(
      parseSearchQuery('civil'),
      {
        visibility: 'INTERNAL',
        dialect: 'modern',
        publicationPolicy: 'legacy-active-only',
        documentScope: { kind: 'PERSONAL', userId: 42 },
      },
      { source: 'CORPUS' },
    );
    expect(JSON.stringify(workspace)).toContain('aclPrincipalIds');
    expect(JSON.stringify(workspace)).toContain('ws-1');
    expect(JSON.stringify(personal)).toContain('ownerUserId');
    expect(JSON.stringify(personal)).toContain('PRIVATE_WORKSPACE');
  });

  it('keeps private logical scope filters while delegating ACL and folder checks to live PostgreSQL', () => {
    const workspace = buildSearchQueryDsl(
      parseSearchQuery('civil'),
      {
        visibility: 'INTERNAL',
        dialect: 'modern',
        publicationPolicy: 'legacy-active-only',
        documentScope: {
          kind: 'WORKSPACE',
          workspaceId: 'ws-1',
          userId: 42,
          folderId: 'folder-1',
        },
      },
      { source: 'CORPUS', livePrivateAcl: true },
    );
    const personal = buildSearchQueryDsl(
      parseSearchQuery('civil'),
      {
        visibility: 'INTERNAL',
        dialect: 'modern',
        publicationPolicy: 'legacy-active-only',
        documentScope: { kind: 'PERSONAL', userId: 42, folderId: 'folder-1' },
      },
      { source: 'CORPUS', livePrivateAcl: true },
    );

    expect(JSON.stringify(workspace)).toContain('ws-1');
    expect(JSON.stringify(workspace)).toContain('PRIVATE_WORKSPACE');
    expect(JSON.stringify(workspace)).not.toContain('aclPrincipalIds');
    expect(JSON.stringify(workspace)).not.toContain('folderId');
    expect(JSON.stringify(personal)).toContain('ownerUserId');
    expect(JSON.stringify(personal)).toContain('PRIVATE_WORKSPACE');
    expect(JSON.stringify(personal)).not.toContain('folderId');
  });

  it('correlates a source folder to the same source and workspace record', () => {
    const query = buildSearchQueryDsl(
      parseSearchQuery('memo'),
      {
        visibility: 'INTERNAL',
        dialect: 'modern',
        publicationPolicy: 'legacy-active-only',
        documentScope: {
          kind: 'WORKSPACE',
          workspaceId: 'ws-1',
          userId: 42,
          sourceId: 'source-1',
          sourceFolder: 'Juzgado\\Civil',
        },
      },
      { source: 'CORPUS' },
    );
    const serialized = JSON.stringify(query);
    expect(serialized).toContain('"path":"sourceFileScopes"');
    expect(serialized).toContain('"sourceFileScopes.sourceId":"source-1"');
    expect(serialized).toContain('"sourceFileScopes.workspaceId":"ws-1"');
    expect(serialized).toContain(
      '"prefix":{"sourceFileScopes.normalizedPath":"Juzgado\\\\Civil\\\\"}',
    );
  });

  it('restricts Jurisprudencia product searches to their logical document kinds', () => {
    const query = buildSearchQueryDsl(
      parseSearchQuery('civil'),
      {
        visibility: 'PUBLIC',
        dialect: 'modern',
        publicationPolicy: 'published-active-only',
        documentKinds: ['SENTENCIA'],
      },
      { source: 'JURISPRUDENCIA' },
    );
    expect(JSON.stringify(query)).toContain('"sourceType":["SENTENCIA"]');
    expect(JSON.stringify(query)).toContain('"publicationStatus":"PUBLISHED"');
  });

  it('applies advanced metadata, publication, phrase, and exclusion filters in OpenSearch', () => {
    const query = buildSearchQueryDsl(
      parseSearchQuery('civil'),
      {
        visibility: 'PUBLIC',
        dialect: 'modern',
        publicationPolicy: 'published-active-only',
        documentKinds: ['SENTENCIA'],
        filters: {
          numeroSumario: 'S-12',
          actor: 'García',
          demandado: 'Provincia',
          objeto: 'daños',
          magistrados: 'Pérez',
          tema: 'responsabilidad',
          anio: 2022,
          activo: true,
          exactPhrase: 'falta de servicio',
          excludeTerms: ['penal'],
        },
      },
      { source: 'JURISPRUDENCIA' },
    );
    const serialized = JSON.stringify(query);
    for (const value of [
      'numeroSumario',
      'actor',
      'demandado',
      'objeto',
      'magistrados',
      'tema',
      '2022-01-01',
      '2023-01-01',
      'publicSearchScopeFields.sentencia.phraseBigrams',
      'publicSearchScopeFields.sumario.phraseBigrams',
    ])
      expect(serialized).toContain(value);
    expect(serialized).toContain('"publicationStatus":"PUBLISHED"');
    expect(serialized).toContain('"active":true');
  });

  it('filters Sentencia number and case expediente against their distinct indexed fields', () => {
    const query = buildSearchQueryDsl(
      parseSearchQuery('civil'),
      {
        visibility: 'PUBLIC',
        dialect: 'modern',
        publicationPolicy: 'published-active-only',
        documentKinds: ['SENTENCIA'],
        filters: {
          expediente: 'EXP-2026-15',
          numeroSentencia: 'S-2026-8',
        },
      },
      { source: 'JURISPRUDENCIA' },
    );
    const serialized = JSON.stringify(query);

    expect(serialized).toContain(
      '"wildcard":{"publicFilterFields.caseNumber":{"value":"*exp-2026-15*","case_insensitive":false}}',
    );
    expect(serialized).toContain(
      '"wildcard":{"publicFields.numeroSentencia":{"value":"*s-2026-8*","case_insensitive":false}}',
    );
    expect(serialized).not.toContain(
      '"wildcard":{"publicFilterFields.caseNumber":{"value":"*s-2026-8*","case_insensitive":false}}',
    );
  });

  it('limits unqualified text to the selected legacy buscarEn scope', () => {
    const query = buildSearchQueryDsl(
      parseSearchQuery('"falta de servicio"'),
      {
        visibility: 'INTERNAL',
        dialect: 'modern',
        publicationPolicy: 'legacy-active-only',
        filters: { buscarEn: ['referencias'] },
      },
      { source: 'JURISPRUDENCIA' },
    );
    const serialized = JSON.stringify(query);
    expect(serialized).toContain('searchScopeFields.referencias.phraseBigrams');
    expect(serialized).not.toContain(
      'searchScopeFields.sentencia.phraseBigrams',
    );
    expect(serialized).not.toContain('searchScopeFields.sumario.phraseBigrams');
  });

  it('normalizes the three PDF aliases and indexes authoritative summary and featured flags', () => {
    for (const filter of [
      { soloConPdf: true },
      { pdf: 'conPdf' as const },
      { tienePdf: true },
    ]) {
      const query = buildSearchQueryDsl(
        parseSearchQuery('civil'),
        {
          visibility: 'INTERNAL',
          dialect: 'modern',
          publicationPolicy: 'legacy-active-only',
          filters: filter,
        },
        { source: 'JURISPRUDENCIA' },
      );
      expect(JSON.stringify(query)).toContain('"hasPdf":true');
    }
    const query = buildSearchQueryDsl(
      parseSearchQuery('civil'),
      {
        visibility: 'INTERNAL',
        dialect: 'modern',
        publicationPolicy: 'legacy-active-only',
        filters: {
          pdf: 'sinPdf',
          soloConResumen: true,
          destacada: false,
        },
      },
      { source: 'JURISPRUDENCIA' },
    );
    const serialized = JSON.stringify(query);
    expect(serialized).toContain('"hasPdf":false');
    expect(serialized).toContain('"hasSummary":true');
    expect(serialized).toContain('"featured":false');
  });
});

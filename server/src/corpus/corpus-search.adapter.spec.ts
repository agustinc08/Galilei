import { CorpusSearchSourceAdapter } from './corpus-search.adapter';
import { parseSearchQuery } from '../busqueda/utils/search-parser';

describe('CorpusSearchSourceAdapter Digesto filters', () => {
  it.each([
    {
      filter: 'digestoCollectionId',
      sql: 'DigestoCollectionMembership',
      value: 'collection-1',
    },
    { filter: 'digestoTopicId', sql: 'CorpusDocumentTopic', value: 'topic-1' },
    { filter: 'digestoTagId', sql: 'CorpusDocumentTag', value: 'tag-1' },
  ])(
    'binds $filter as a parameterized Corpus predicate',
    async ({ filter, sql, value }) => {
      const adapter = new CorpusSearchSourceAdapter(
        'postgresql://bjc_dev:test@127.0.0.1:55432/buscador_juridico_civil_dev',
      );
      const pool = (
        adapter as unknown as {
          pool: {
            query: (...args: unknown[]) => unknown;
            end: () => Promise<void>;
          };
        }
      ).pool;
      const query = jest
        .spyOn(pool, 'query')
        .mockResolvedValueOnce({
          rows: [{ isReady: true }],
          rowCount: 1,
        } as never)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
      try {
        await adapter.search(parseSearchQuery('responsabilidad'), {
          visibility: 'INTERNAL',
          dialect: 'modern',
          publicationPolicy: 'published-active-only',
          page: 1,
          pageSize: 10,
          filters: { [filter]: value },
        });
        const [candidateSql, values] = query.mock.calls[1] as [
          string,
          unknown[],
        ];
        expect(candidateSql).toContain(sql);
        expect(values).toContain(value);
        expect(candidateSql).not.toContain(value);
        expect(query).toHaveBeenCalledTimes(2);
      } finally {
        await adapter.close();
      }
    },
  );

  it('uses a bounded token EXISTS lookup for short terms instead of building every candidate ID', async () => {
    const adapter = new CorpusSearchSourceAdapter(
      'postgresql://bjc_dev:test@127.0.0.1:55432/buscador_juridico_civil_dev',
    );
    const pool = (
      adapter as unknown as {
        pool: {
          query: (...args: unknown[]) => unknown;
          end: () => Promise<void>;
        };
      }
    ).pool;
    const query = jest
      .spyOn(pool, 'query')
      .mockResolvedValueOnce({
        rows: [{ isReady: true }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    try {
      await adapter.search(parseSearchQuery('de'), {
        visibility: 'INTERNAL',
        dialect: 'modern',
        publicationPolicy: 'published-active-only',
        page: 1,
        pageSize: 10,
      });
      const [sql, values] = query.mock.calls[1] as [string, unknown[]];
      expect(sql).toContain('EXISTS (SELECT 1 FROM "CorpusSearchToken" token');
      expect(sql).toContain('LIMIT ($4 + 1) OFFSET $5');
      expect(sql).not.toContain('SELECT DISTINCT token."documentId"');
      expect(values).toContain('%de%');
      expect(adapter.getLastSearchProfile()?.candidateStrategy).toBe(
        'token-projection-short-window-v2',
      );
    } finally {
      await adapter.close();
    }
  });
});

describe('CorpusSearchSourceAdapter generic full-text search', () => {
  it('skips token-projection readiness during OpenSearch page hydration', async () => {
    const adapter = new CorpusSearchSourceAdapter(
      'postgresql://bjc_dev:test@127.0.0.1:55432/buscador_juridico_civil_dev',
    );
    const pool = (
      adapter as unknown as {
        pool: {
          query: (...args: unknown[]) => unknown;
          end: () => Promise<void>;
        };
      }
    ).pool;
    const query = jest
      .spyOn(pool, 'query')
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    try {
      const result = await adapter.search(
        parseSearchQuery('"responsabilidad civil"'),
        {
          visibility: 'INTERNAL',
          dialect: 'modern',
          publicationPolicy: 'published-active-only',
          page: 1,
          pageSize: 20,
        },
        ['corpus-document-1'],
      );

      expect(result.totalExact).toBe(true);
      expect(query).toHaveBeenCalledTimes(1);
      expect(query.mock.calls[0][0]).toContain('d."id" = ANY');
      expect(query.mock.calls[0][0]).toContain(
        'pageMatch."text" AS "matchedPageText"',
      );
      expect(query.mock.calls[0][0]).not.toContain('AS "snippetText"');
      expect(query.mock.calls[0][0]).not.toContain('AS "extractedText"');
      expect(query.mock.calls[0][0]).not.toContain('regexp_replace');
      expect(adapter.getLastSearchProfile()?.queryCount).toBe(1);
    } finally {
      await adapter.close();
    }
  });

  it('keeps the matched phrase visible in hydrated document snippets', async () => {
    const adapter = new CorpusSearchSourceAdapter(
      'postgresql://bjc_dev:test@127.0.0.1:55432/buscador_juridico_civil_dev',
    );
    const pool = (
      adapter as unknown as {
        pool: {
          query: (...args: unknown[]) => unknown;
          end: () => Promise<void>;
        };
      }
    ).pool;
    const extractedText = `${'Antecedente '.repeat(12)}Responsabilidad civil en el caso de prueba.`;
    jest.spyOn(pool, 'query').mockResolvedValueOnce({
      rows: [
        {
          id: 'corpus-document-1',
          title: 'Documento de prueba',
          subtitle: null,
          decisionDate: null,
          documentType: 'SENTENCIA',
          jurisdiction: 'CIVIL',
          court: null,
          chamber: null,
          instance: null,
          caseNumber: null,
          visibility: 'INTERNAL',
          snippetSource: extractedText,
          fileId: null,
          fileMimeType: null,
          checksum: null,
          filename: null,
          sourceCode: null,
          externalId: null,
          sourceReference: null,
          matchedPage: null,
          total: '1',
          hasMore: false,
          linkedResultIds: [],
          digestoCollections: null,
          digestoTopics: null,
          digestoTags: null,
        },
      ],
      rowCount: 1,
    } as never);
    try {
      const result = await adapter.search(
        parseSearchQuery('"responsabilidad civil"'),
        {
          visibility: 'INTERNAL',
          dialect: 'modern',
          publicationPolicy: 'published-active-only',
          page: 1,
          pageSize: 20,
        },
        ['corpus-document-1'],
      );

      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.snippet).toContain('Responsabilidad civil');
      expect(result.results[0]?.snippet).toContain('Antecedente');
      const [sql] = (pool.query as jest.Mock).mock.calls[0] as [string];
      expect(sql).toContain(
        'COALESCE(NULLIF(pageMatch."text", \'\'), NULLIF(d."searchText", \'\'), \'\') AS "snippetSource"',
      );
      expect(sql).not.toContain('AS "extractedText"');
    } finally {
      await adapter.close();
    }
  });

  it('returns page-scoped OCR provenance and the snippet from the approved physical page', async () => {
    const adapter = new CorpusSearchSourceAdapter(
      'postgresql://bjc_dev:test@127.0.0.1:55432/buscador_juridico_civil_dev',
    );
    const pool = (
      adapter as unknown as {
        pool: {
          query: (...args: unknown[]) => unknown;
          end: () => Promise<void>;
        };
      }
    ).pool;
    jest.spyOn(pool, 'query').mockResolvedValueOnce({
      rows: [
        {
          id: 'corpus-document-ocr',
          title: 'OCR sintético',
          subtitle: null,
          decisionDate: null,
          documentType: 'SENTENCIA',
          jurisdiction: 'CIVIL',
          court: null,
          chamber: null,
          instance: null,
          caseNumber: null,
          visibility: 'INTERNAL',
          snippetSource: 'Documento completo sin el pasaje esperado.',
          matchedPageText:
            'Página 17: responsabilidad civil revisada y aprobada.',
          matchedPageTextKind: 'OCR',
          matchedPageProcessingStatus: 'OCR_HUMAN_APPROVED',
          activeExtractionStatus: 'OCR_HUMAN_APPROVED',
          matchedPage: 17,
          matchedPageCount: 2,
          fileId: null,
          fileMimeType: 'application/pdf',
          checksum: 'a'.repeat(64),
          filename: 'sintetico.pdf',
          sourceCode: 'QA',
          externalId: null,
          sourceReference: null,
          total: '1',
          hasMore: false,
          linkedResultIds: [],
          digestoCollections: null,
          digestoTopics: null,
          digestoTags: null,
        },
      ],
      rowCount: 1,
    } as never);
    try {
      const result = await adapter.search(
        parseSearchQuery('"responsabilidad civil"'),
        {
          visibility: 'INTERNAL',
          dialect: 'modern',
          publicationPolicy: 'published-active-only',
          page: 1,
          pageSize: 10,
        },
        ['corpus-document-ocr'],
      );
      const match = result.results[0];
      expect(match.snippet).toContain('Página 17');
      expect(match.metadata).toMatchObject({
        pageNumber: 17,
        matchSource: 'OCR_APPROVED',
        matchedPageCount: 2,
      });
      expect(match.metadata.pageTextSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(JSON.stringify(match)).not.toContain('sourceExtractionId');
      expect(match.metadata).not.toHaveProperty('textSourceVersion');
    } finally {
      await adapter.close();
    }
  });

  it('fails closed when an OCR page is not from an active approved extraction', async () => {
    const adapter = new CorpusSearchSourceAdapter(
      'postgresql://bjc_dev:test@127.0.0.1:55432/buscador_juridico_civil_dev',
    );
    const pool = (
      adapter as unknown as {
        pool: {
          query: (...args: unknown[]) => unknown;
          end: () => Promise<void>;
        };
      }
    ).pool;
    jest.spyOn(pool, 'query').mockResolvedValueOnce({
      rows: [
        {
          id: 'corpus-document-draft',
          title: 'OCR no aprobado',
          subtitle: null,
          decisionDate: null,
          documentType: 'SENTENCIA',
          jurisdiction: 'CIVIL',
          court: null,
          chamber: null,
          instance: null,
          caseNumber: null,
          visibility: 'INTERNAL',
          snippetSource: 'responsabilidad civil desde fuente activa',
          matchedPageText: 'DRAFT_SECRET responsabilidad civil',
          matchedPageTextKind: 'OCR',
          matchedPageProcessingStatus: 'OCR_DRAFT',
          activeExtractionStatus: 'TEXT_EXTRACTED',
          matchedPage: 99,
          matchedPageCount: 1,
          fileId: null,
          fileMimeType: 'application/pdf',
          checksum: null,
          filename: null,
          sourceCode: null,
          externalId: null,
          sourceReference: null,
          total: '1',
          hasMore: false,
          linkedResultIds: [],
          digestoCollections: null,
          digestoTopics: null,
          digestoTags: null,
        },
      ],
      rowCount: 1,
    } as never);
    try {
      const result = await adapter.search(
        parseSearchQuery('"responsabilidad civil"'),
        {
          visibility: 'INTERNAL',
          dialect: 'modern',
          publicationPolicy: 'published-active-only',
          page: 1,
          pageSize: 10,
        },
        ['corpus-document-draft'],
      );
      expect(result.results[0]?.snippet).toContain('desde fuente activa');
      expect(result.results[0]?.snippet).not.toContain('DRAFT_SECRET');
      const [candidateSql] = (pool.query as jest.Mock).mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(candidateSql).toContain('NULLIF(d."searchText", \'\')');
      expect(candidateSql).not.toContain('NULLIF(e."text", \'\')');
      expect(result.results[0]?.metadata).toMatchObject({
        pageNumber: null,
        matchSource: null,
      });
      expect(result.results[0]?.metadata).not.toHaveProperty(
        'textSourceVersion',
      );
    } finally {
      await adapter.close();
    }
  });

  it('uses the token projection and a bounded first-page candidate window', async () => {
    const adapter = new CorpusSearchSourceAdapter(
      'postgresql://bjc_dev:test@127.0.0.1:55432/buscador_juridico_civil_dev',
    );
    const pool = (
      adapter as unknown as {
        pool: {
          query: (...args: unknown[]) => unknown;
          end: () => Promise<void>;
        };
      }
    ).pool;
    const query = jest
      .spyOn(pool, 'query')
      .mockResolvedValueOnce({
        rows: [{ isReady: true }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    try {
      await adapter.search(parseSearchQuery('responsabilidad'), {
        visibility: 'INTERNAL',
        dialect: 'modern',
        publicationPolicy: 'published-active-only',
        page: 1,
        pageSize: 10,
      });
      const [candidateSql, values] = query.mock.calls[1] as [string, unknown[]];
      expect(candidateSql).toContain('"CorpusSearchToken" token');
      expect(candidateSql).toContain('lower(token."token") LIKE $2');
      expect(candidateSql.indexOf('"candidateWindow"')).toBeLessThan(
        candidateSql.indexOf('SELECT p."pageNumber"'),
      );
      expect(candidateSql).toContain('FROM "pagedCandidates" selected');
      expect(values).toContain('responsabilidad%');
      expect(candidateSql).toContain('LIMIT ($4 + 1) OFFSET $5');
      expect(candidateSql).toContain('"pageStats"');
      expect(candidateSql).not.toContain('count(*) OVER()');
      expect(candidateSql).toContain(
        'pageMatch."matchedPageCount" AS "matchedPageCount"',
      );
      expect(query).toHaveBeenCalledTimes(2);
    } finally {
      await adapter.close();
    }
  });

  it('reuses the verified workspace candidate set for an exact term total', async () => {
    const adapter = new CorpusSearchSourceAdapter(
      'postgresql://bjc_dev:test@127.0.0.1:55432/buscador_juridico_civil_dev',
    );
    const pool = (
      adapter as unknown as {
        pool: {
          query: (...args: unknown[]) => unknown;
          end: () => Promise<void>;
        };
      }
    ).pool;
    const query = jest
      .spyOn(pool, 'query')
      .mockResolvedValueOnce({
        rows: [{ isReady: true }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
      .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 } as never);
    try {
      const result = await adapter.search(
        parseSearchQuery('workspacefixturetoken'),
        {
          visibility: 'INTERNAL',
          dialect: 'modern',
          publicationPolicy: 'published-active-only',
          page: 1,
          pageSize: 20,
          documentScope: {
            kind: 'WORKSPACE',
            workspaceId: 'workspace-1',
            userId: 17,
            folderId: null,
          },
        },
      );

      const [exactCountSql] = query.mock.calls[2] as [string, unknown[]];
      expect(exactCountSql).toContain(
        'WITH "corpusWorkspaceDocuments" AS MATERIALIZED',
      );
      expect(exactCountSql).toContain(
        'FROM "WorkspaceDocument" workspaceDocument',
      );
      expect(exactCountSql).toContain('FROM "CorpusSearchToken" token');
      expect(exactCountSql).toContain(
        'FROM "corpusSearchCandidates" candidates',
      );
      expect(exactCountSql).toContain(
        'JOIN "CorpusDocument" d ON d."id" = candidates."id"',
      );
      expect(exactCountSql).toContain('lower(scopedToken."token") LIKE');
      expect(exactCountSql).not.toContain('d."searchText" ILIKE');
      expect(query.mock.calls[2]?.[1]).toContain('workspacefixturetoken%');
      expect(result.total).toBe(0);
      expect(result.totalExact).toBe(true);
      expect(query).toHaveBeenCalledTimes(3);
    } finally {
      await adapter.close();
    }
  });

  it('uses one phrase token anchor, then verifies the exact phrase before paging', async () => {
    const adapter = new CorpusSearchSourceAdapter(
      'postgresql://bjc_dev:test@127.0.0.1:55432/buscador_juridico_civil_dev',
    );
    const pool = (
      adapter as unknown as {
        pool: {
          query: (...args: unknown[]) => unknown;
          end: () => Promise<void>;
        };
      }
    ).pool;
    const query = jest
      .spyOn(pool, 'query')
      .mockResolvedValueOnce({
        rows: [{ isReady: true }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            id: null,
            total: '12',
            candidateCount: '1000',
            totalExact: true,
            hasMore: true,
            candidateWindowSizes: [1000],
            exactHitsByWindow: [12],
          },
        ],
        rowCount: 1,
      } as never);
    try {
      await adapter.search(parseSearchQuery('"responsabilidad civil"'), {
        visibility: 'INTERNAL',
        dialect: 'modern',
        publicationPolicy: 'published-active-only',
        page: 1,
        pageSize: 10,
      });
      const [sql, values] = query.mock.calls[1] as [string, unknown[]];
      expect(sql).toContain('d."searchText" ILIKE');
      expect(sql).toContain('"CorpusSearchToken" token');
      expect(sql).not.toContain('"phraseWindowScan"');
      expect(sql).toContain('"verifiedCandidates" AS MATERIALIZED');
      expect(sql).toContain('true AS "totalExact"');
      expect(sql).toContain('AND d."searchText" ILIKE');
      expect(sql).toContain('"candidateWindowSizes"');
      expect(sql).toContain('FROM "corpusSearchCandidates" c');
      expect(sql).not.toContain('scan."verifiedCount" <=');
      expect(
        sql.match(/"corpusSearchCandidates" AS MATERIALIZED/gu),
      ).toHaveLength(1);
      expect(values).toContain('%responsabilidad civil%');
      expect(query).toHaveBeenCalledTimes(2);
      expect(adapter.getLastSearchProfile()?.candidateStrategy).toBe(
        'corpus-token-phrase-exact-v12',
      );
      expect(adapter.getLastSearchProfile()?.candidateGenerationCount).toBe(1);
      expect(adapter.getLastSearchProfile()?.candidateCount).toBe(1000);
      expect(adapter.getLastSearchProfile()?.windowExpansions).toBe(0);
      expect(adapter.getLastSearchProfile()?.windowSizes).toEqual([1000]);
      expect(adapter.getLastSearchProfile()?.exactHitsByWindow).toEqual([12]);
    } finally {
      await adapter.close();
    }
  });

  it('uses exact Corpus text for phrase candidates and verifies the full phrase', async () => {
    const adapter = new CorpusSearchSourceAdapter(
      'postgresql://bjc_dev:test@127.0.0.1:55432/buscador_juridico_civil_dev',
    );
    const pool = (
      adapter as unknown as {
        pool: {
          query: (...args: unknown[]) => unknown;
          end: () => Promise<void>;
        };
      }
    ).pool;
    const query = jest
      .spyOn(pool, 'query')
      .mockResolvedValueOnce({
        rows: [{ isReady: true }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            id: null,
            total: '2',
            candidateCount: '100',
            totalExact: false,
            hasMore: true,
            candidateWindowSizes: [100],
            exactHitsByWindow: [2],
          },
        ],
        rowCount: 1,
      } as never);
    try {
      await adapter.search(parseSearchQuery('"falta de servicio"'), {
        visibility: 'INTERNAL',
        dialect: 'modern',
        publicationPolicy: 'published-active-only',
        page: 1,
        pageSize: 10,
      });
      const [sql, values] = query.mock.calls[1] as [string, unknown[]];
      expect(sql).toContain('"CorpusSearchToken" token');
      expect(sql).toContain('AND d."searchText" ILIKE');
      expect(sql).toContain('AND d."searchText" ILIKE');
      expect(values).toContain('%falta de servicio%');
    } finally {
      await adapter.close();
    }
  });

  it('uses exact Corpus text candidates for multiword phrases', async () => {
    const adapter = new CorpusSearchSourceAdapter(
      'postgresql://bjc_dev:test@127.0.0.1:55432/buscador_juridico_civil_dev',
    );
    const pool = (
      adapter as unknown as {
        pool: {
          query: (...args: unknown[]) => unknown;
          end: () => Promise<void>;
        };
      }
    ).pool;
    const query = jest
      .spyOn(pool, 'query')
      .mockResolvedValueOnce({
        rows: [{ isReady: true }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            id: null,
            total: '1',
            candidateCount: '1',
            totalExact: false,
            hasMore: false,
            candidateWindowSizes: [100],
            exactHitsByWindow: [1],
          },
        ],
        rowCount: 1,
      } as never);
    try {
      await adapter.search(parseSearchQuery('"alpha needle omega"'), {
        visibility: 'INTERNAL',
        dialect: 'modern',
        publicationPolicy: 'published-active-only',
        page: 1,
        pageSize: 10,
      });
      const [sql, values] = query.mock.calls[1] as [string, unknown[]];
      expect(sql).toContain('d."searchText" ILIKE');
      expect(sql).toContain('"CorpusSearchToken" token');
      expect(values).toContain('%alpha needle omega%');
      expect(query).toHaveBeenCalledTimes(2);
    } finally {
      await adapter.close();
    }
  });

  it('hydrates a bounded phrase snippet instead of transferring full document text', async () => {
    const adapter = new CorpusSearchSourceAdapter(
      'postgresql://bjc_dev:test@127.0.0.1:55432/buscador_juridico_civil_dev',
    );
    const pool = (
      adapter as unknown as {
        pool: {
          query: (...args: unknown[]) => unknown;
          end: () => Promise<void>;
        };
      }
    ).pool;
    const query = jest
      .spyOn(pool, 'query')
      .mockResolvedValueOnce({
        rows: [{ isReady: true }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'doc-1',
            title: 'Title',
            subtitle: null,
            decisionDate: null,
            documentType: 'PDF',
            jurisdiction: 'CIVIL',
            court: null,
            chamber: null,
            instance: null,
            caseNumber: null,
            visibility: 'INTERNAL',
            snippetText: '…context responsabilidad civil context…',
            fileId: null,
            fileMimeType: 'application/pdf',
            checksum: null,
            filename: null,
            sourceCode: null,
            externalId: null,
            sourceReference: null,
            matchedPage: 1,
            total: '1',
            hasMore: false,
            linkedResultIds: [],
            digestoCollections: null,
            digestoTopics: null,
            digestoTags: null,
            totalExact: true,
            candidateCount: '1',
            candidateWindowSizes: [100],
            exactHitsByWindow: [1],
          },
        ],
        rowCount: 1,
      } as never);
    try {
      const result = await adapter.search(
        parseSearchQuery('"responsabilidad civil"'),
        {
          visibility: 'INTERNAL',
          dialect: 'modern',
          publicationPolicy: 'published-active-only',
          page: 1,
          pageSize: 10,
        },
      );
      const [sql] = query.mock.calls[1] as [string, unknown[]];
      expect(sql).toContain('AS "snippetText"');
      expect(sql).not.toContain('AS "extractedText"');
      expect(result.results[0]?.snippet).toBe(
        '…context responsabilidad civil context…',
      );
    } finally {
      await adapter.close();
    }
  });

  it.each([
    { queryText: 'responsa%', expected: 'lower(token."token") LIKE' },
    { queryText: '%bilidad', expected: 'reverse(token."token") LIKE' },
    { queryText: '%sponsabili%', expected: 'token."token" ILIKE' },
  ])(
    'uses token projection for $queryText without scanning the full text for candidates',
    async ({ queryText, expected }) => {
      const adapter = new CorpusSearchSourceAdapter(
        'postgresql://bjc_dev:test@127.0.0.1:55432/buscador_juridico_civil_dev',
      );
      const pool = (
        adapter as unknown as {
          pool: {
            query: (...args: unknown[]) => unknown;
            end: () => Promise<void>;
          };
        }
      ).pool;
      const query = jest
        .spyOn(pool, 'query')
        .mockResolvedValueOnce({
          rows: [{ isReady: true }],
          rowCount: 1,
        } as never)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
      try {
        await adapter.search(parseSearchQuery(queryText), {
          visibility: 'INTERNAL',
          dialect: 'modern',
          publicationPolicy: 'published-active-only',
          page: 1,
          pageSize: 10,
        });
        const [sql] = query.mock.calls[1] as [string, unknown[]];
        expect(sql).toContain(expected);
        expect(sql).toContain('FROM "CorpusSearchToken" token');
        expect(sql).toContain('"candidateWindow"');
        expect(sql).not.toContain('WHERE d."searchText" ILIKE');
      } finally {
        await adapter.close();
      }
    },
  );

  it('falls back to exact source text while the token projection is not ready', async () => {
    const adapter = new CorpusSearchSourceAdapter(
      'postgresql://bjc_dev:test@127.0.0.1:55432/buscador_juridico_civil_dev',
    );
    const pool = (
      adapter as unknown as {
        pool: {
          query: (...args: unknown[]) => unknown;
          end: () => Promise<void>;
        };
      }
    ).pool;
    const query = jest
      .spyOn(pool, 'query')
      .mockResolvedValueOnce({
        rows: [{ isReady: false }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    try {
      await adapter.search(parseSearchQuery('responsabilidad'), {
        visibility: 'INTERNAL',
        dialect: 'modern',
        publicationPolicy: 'published-active-only',
        page: 1,
        pageSize: 10,
      });
      const [sql] = query.mock.calls[1] as [string, unknown[]];
      expect(sql).toContain('d."searchText" ILIKE $2');
      expect(sql).not.toContain('FROM "CorpusSearchToken" token');
    } finally {
      await adapter.close();
    }
  });
});

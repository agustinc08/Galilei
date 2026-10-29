import { CorpusDocumentAccessService } from './corpus-document-access.service';
import type { PrismaService } from '../prisma/prisma.service';

describe('Corpus document access in workspaces', () => {
  const document = {
    id: 'internal-general-document',
    documentType: 'SENTENCIA',
    title: 'Documento técnico de control',
    subtitle: null,
    jurisdiction: null,
    court: null,
    chamber: null,
    instance: null,
    caseNumber: null,
    decisionDate: null,
    visibility: 'INTERNAL',
    documentScope: 'GENERAL',
    status: 'INDEXED',
    metadata: {},
    files: [],
    latestExtraction: null,
    ingestions: [],
  };

  const makeService = (publishedSentence: { id: number } | null) => {
    const corpusDocumentFindFirst = jest.fn().mockResolvedValue(document);
    const corpusDocumentLinkFindMany = jest
      .fn()
      .mockResolvedValue([{ targetId: '4711' }]);
    const sentenciaFindFirst = jest.fn().mockResolvedValue(publishedSentence);
    const queryRaw = jest.fn().mockResolvedValue([{ allowed: true }]);
    const prisma = {
      $queryRaw: queryRaw,
      corpusDocument: { findFirst: corpusDocumentFindFirst },
      corpusDocumentLink: { findMany: corpusDocumentLinkFindMany },
      sentencia: { findFirst: sentenciaFindFirst },
    } as unknown as PrismaService;

    return {
      service: new CorpusDocumentAccessService(prisma),
      queryRaw,
      corpusDocumentFindFirst,
      corpusDocumentLinkFindMany,
      sentenciaFindFirst,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows a member to read an INTERNAL GENERAL document linked to a published sentence', async () => {
    const {
      service,
      queryRaw,
      corpusDocumentFindFirst,
      corpusDocumentLinkFindMany,
      sentenciaFindFirst,
    } = makeService({ id: 4711 });

    await expect(
      service.metadata(
        'internal-general-document',
        'RESTRICTED',
        undefined,
        'workspace-1',
        553,
      ),
    ).resolves.toMatchObject({
      id: 'internal-general-document',
      visibility: 'INTERNAL',
    });

    expect(queryRaw).toHaveBeenCalled();

    const corpusCalls = corpusDocumentFindFirst.mock.calls as unknown[][];
    const corpusArgs: unknown = corpusCalls[0]?.[0];
    const corpusWhere = (
      corpusArgs as {
        where?: {
          OR?: Array<{
            documentScope?: string;
            visibility?: { in?: string[] };
          }>;
          workspaceDocuments?: unknown;
          visibility?: { in?: string[] };
        };
      }
    ).where;
    expect(corpusWhere?.OR?.map((branch) => branch.documentScope)).toEqual(
      expect.arrayContaining(['PRIVATE_WORKSPACE', 'GENERAL']),
    );
    expect(
      corpusWhere?.OR?.find((branch) => branch.documentScope === 'GENERAL')
        ?.visibility?.in,
    ).toEqual(['PUBLIC', 'INTERNAL']);
    expect(corpusWhere?.workspaceDocuments).toEqual({
      some: { workspaceId: 'workspace-1' },
    });
    expect(corpusWhere?.visibility?.in).toEqual([
      'PUBLIC',
      'INTERNAL',
      'RESTRICTED',
    ]);

    const linkCalls = corpusDocumentLinkFindMany.mock.calls as unknown[][];
    const linkArgs: unknown = linkCalls[0]?.[0];
    const linkWhere = (linkArgs as { where?: Record<string, unknown> }).where;
    expect(linkWhere).toMatchObject({
      documentId: 'internal-general-document',
      targetDomain: 'JURISPRUDENCIA',
      targetType: 'SENTENCIA',
      relationship: 'ASSOCIATED_WITH',
    });

    const sentenciaCalls = sentenciaFindFirst.mock.calls as unknown[][];
    const sentenciaArgs: unknown = sentenciaCalls[0]?.[0];
    const sentenciaWhere = (
      sentenciaArgs as { where?: Record<string, unknown> }
    ).where;
    expect(sentenciaWhere).toMatchObject({
      id: { in: [4711] },
      publicado: true,
      activo: true,
      estadoCarga: 'PUBLICADA',
    });
  });

  it('fails closed when the INTERNAL GENERAL document has no published sentence link', async () => {
    const { service, sentenciaFindFirst } = makeService(null);

    await expect(
      service.metadata(
        'internal-general-document',
        'RESTRICTED',
        undefined,
        'workspace-1',
        553,
      ),
    ).rejects.toMatchObject({ status: 404 });

    expect(sentenciaFindFirst).toHaveBeenCalled();
  });
});

import type { API } from '@opensearch-project/opensearch';
import { mimeTypesForCorpusTypes } from '../busqueda/utils/search-filters';
import type {
  CorpusFileType,
  SearchDateRange,
} from '../busqueda/utils/search-filters';

type QueryContainer = NonNullable<API.Search_RequestBody['query']>;

export function buildWorkspaceNameSearchDsl(input: {
  workspaceId: string;
  userId: number;
  term: string;
  folderId?: string | null;
  sourceId?: string;
  sourceFolder?: string;
  types?: CorpusFileType[];
  dateRange: SearchDateRange;
}) {
  const escaped = input.term.replace(/[\\*?]/gu, '\\$&');
  const filters: QueryContainer[] = [
    { term: { sourceSystem: 'CORPUS' } },
    {
      bool: {
        should: [
          { term: { documentScope: 'PRIVATE_WORKSPACE' } },
          {
            bool: {
              filter: [
                { term: { documentScope: 'GENERAL' } },
                { terms: { visibility: ['PUBLIC', 'INTERNAL'] } },
              ],
            },
          },
        ],
        minimum_should_match: 1,
      },
    },
    { term: { workspaceId: input.workspaceId } },
    { term: { aclPrincipalIds: String(input.userId) } },
    { bool: { must_not: [{ exists: { field: 'ownerUserId' } }] } },
  ];
  if (input.folderId !== undefined) {
    filters.push(
      input.folderId === null
        ? { bool: { must_not: [{ exists: { field: 'folderId' } }] } }
        : { term: { folderId: input.folderId } },
    );
  }
  if (input.sourceId === '__manual_upload__') {
    filters.push({
      bool: {
        must_not: [{ term: { sourceWorkspaceIds: input.workspaceId } }],
      },
    });
  } else if (input.sourceId) {
    filters.push({
      nested: {
        path: 'sourceFileScopes',
        query: {
          bool: {
            filter: [
              { term: { 'sourceFileScopes.sourceId': input.sourceId } },
              { term: { 'sourceFileScopes.workspaceId': input.workspaceId } },
              ...(input.sourceFolder
                ? [sourceFolderFilter(input.sourceFolder)]
                : []),
            ],
          },
        },
      },
    });
  } else if (input.sourceFolder) {
    filters.push({ match_none: {} });
  }
  if (input.types?.length)
    filters.push({ terms: { mimeType: mimeTypesForCorpusTypes(input.types) } });
  if (input.dateRange.dateFrom || input.dateRange.dateTo) {
    const dateRange: Record<string, string> = {};
    if (input.dateRange.dateFrom) dateRange.gte = input.dateRange.dateFrom;
    if (input.dateRange.dateTo) {
      const end = new Date(`${input.dateRange.dateTo}T00:00:00.000Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      dateRange.lt = end.toISOString().slice(0, 10);
    }
    filters.push({ range: { decisionDate: dateRange } });
  }
  const nameMatches: QueryContainer[] = [
    {
      wildcard: {
        'workspaceNameFields.title': {
          value: `*${escaped}*`,
          case_insensitive: true,
        },
      },
    },
    {
      wildcard: {
        'workspaceNameFields.filename': {
          value: `*${escaped}*`,
          case_insensitive: true,
        },
      },
    },
  ];
  return {
    bool: {
      filter: filters,
      must: [
        {
          bool: {
            should: nameMatches,
            minimum_should_match: 1,
          },
        },
      ],
    },
  } satisfies QueryContainer;
}

function sourceFolderFilter(sourceFolder: string): QueryContainer {
  const folder = sourceFolder.replace(/\\+$/u, '');
  return {
    bool: {
      should: [
        { term: { 'sourceFileScopes.normalizedPath': sourceFolder } },
        {
          prefix: {
            'sourceFileScopes.normalizedPath': `${folder}\\`,
          },
        },
      ],
      minimum_should_match: 1,
    },
  };
}

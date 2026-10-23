export type OpenSearchIndexClassification =
  | 'BJC_APPLICATION_INDEX'
  | 'OPENSEARCH_INTERNAL_INDEX'
  | 'UNKNOWN_NON_BJC_INDEX';

export type OpenSearchAliasClassification =
  | 'BJC_APPLICATION_ALIAS'
  | 'OPENSEARCH_INTERNAL_ALIAS'
  | 'UNKNOWN_NON_BJC_ALIAS';

export interface OpenSearchAliasTarget {
  alias?: string;
  index?: string;
}

export interface OpenSearchTopology {
  indices: string[];
  aliases: OpenSearchAliasTarget[];
}

export interface FreshV4TopologyExpectation {
  indexPrefix: string;
  activeAlias: string;
  expectedIndex?: string;
  expectedAliasTarget?: string;
}

const INTERNAL_INDEX_PREFIXES = ['.', 'top_queries-'] as const;
const BJC_OWNERSHIP_PREFIXES = ['galilei-', 'bjc-'] as const;

function startsWithNamespace(value: string, prefix: string): boolean {
  if (prefix.endsWith('-') || prefix.endsWith('_')) {
    return value.startsWith(prefix);
  }
  return value === prefix || value.startsWith(`${prefix}-`);
}

export function classifyOpenSearchIndex(
  index: string,
  applicationIndexPrefix: string,
): OpenSearchIndexClassification {
  if (
    startsWithNamespace(index, applicationIndexPrefix) ||
    BJC_OWNERSHIP_PREFIXES.some((prefix) => startsWithNamespace(index, prefix))
  ) {
    return 'BJC_APPLICATION_INDEX';
  }

  if (INTERNAL_INDEX_PREFIXES.some((prefix) => index.startsWith(prefix))) {
    return 'OPENSEARCH_INTERNAL_INDEX';
  }

  return 'UNKNOWN_NON_BJC_INDEX';
}

export function classifyOpenSearchAlias(
  alias: string,
  activeAlias: string,
): OpenSearchAliasClassification {
  if (
    alias === activeAlias ||
    BJC_OWNERSHIP_PREFIXES.some((prefix) => startsWithNamespace(alias, prefix))
  ) {
    return 'BJC_APPLICATION_ALIAS';
  }

  if (alias.startsWith('.')) return 'OPENSEARCH_INTERNAL_ALIAS';
  return 'UNKNOWN_NON_BJC_ALIAS';
}

export function assertFreshV4Topology(
  topology: OpenSearchTopology,
  expectation: FreshV4TopologyExpectation,
): void {
  const applicationIndices = topology.indices.filter(
    (index) =>
      classifyOpenSearchIndex(index, expectation.indexPrefix) ===
      'BJC_APPLICATION_INDEX',
  );
  const unknownIndices = topology.indices.filter(
    (index) =>
      classifyOpenSearchIndex(index, expectation.indexPrefix) ===
      'UNKNOWN_NON_BJC_INDEX',
  );
  const applicationAliases = topology.aliases.filter(
    (entry) =>
      typeof entry.alias === 'string' &&
      classifyOpenSearchAlias(entry.alias, expectation.activeAlias) ===
        'BJC_APPLICATION_ALIAS',
  );
  const unknownAliases = topology.aliases.filter(
    (entry) =>
      typeof entry.alias !== 'string' ||
      classifyOpenSearchAlias(entry.alias, expectation.activeAlias) ===
        'UNKNOWN_NON_BJC_ALIAS',
  );

  if (unknownIndices.length > 0) {
    throw new Error('SEARCH_FRESH_V4_UNEXPECTED_NON_BJC_INDEX');
  }

  const expectedIndices = expectation.expectedIndex
    ? [expectation.expectedIndex]
    : [];
  if (
    applicationIndices.length !== expectedIndices.length ||
    expectedIndices.some((index) => !applicationIndices.includes(index))
  ) {
    throw new Error('SEARCH_FRESH_V4_UNEXPECTED_INDICES');
  }

  if (unknownAliases.length > 0) {
    throw new Error('SEARCH_FRESH_V4_UNEXPECTED_NON_BJC_ALIAS');
  }

  const expectedAliasTarget = expectation.expectedAliasTarget;
  if (expectedAliasTarget) {
    if (
      applicationAliases.length !== 1 ||
      applicationAliases[0].alias !== expectation.activeAlias ||
      applicationAliases[0].index !== expectedAliasTarget
    ) {
      throw new Error('SEARCH_FRESH_V4_UNEXPECTED_ALIAS_STATE');
    }
    return;
  }

  if (applicationAliases.length > 0) {
    throw new Error('SEARCH_FRESH_V4_UNEXPECTED_ALIAS_STATE');
  }
}

export const SEARCH_SYNTAX_VERSION = 'bjc-v1' as const;

export type SearchFieldName =
  | 'tema'
  | 'sala'
  | 'tipoFallo'
  | 'tribunalOrigen'
  | 'expediente'
  | 'caratula'
  | 'actor'
  | 'demandado'
  | 'objeto'
  | 'magistrados'
  | 'numeroSentencia'
  | 'numeroSumario';

export type SearchMatchMode = 'contains' | 'prefix' | 'suffix';

export type SearchTermNode = {
  type: 'term';
  value: string;
  normalizedValue: string;
  field?: SearchFieldName;
  matchMode: SearchMatchMode;
  /** Original spelling of the token, retained for compatibility explanations. */
  sourceText: string;
};

export type SearchPhraseNode = {
  type: 'phrase';
  value: string;
  normalizedValue: string;
  field?: SearchFieldName;
  sourceText: string;
};

export type SearchNotNode = { type: 'not'; operand: SearchNode };
export type SearchAndNode = { type: 'and'; operands: SearchNode[] };
export type SearchOrNode = { type: 'or'; operands: SearchNode[] };

export type SearchNode =
  | SearchTermNode
  | SearchPhraseNode
  | SearchNotNode
  | SearchAndNode
  | SearchOrNode;

export type SearchQueryAst = {
  syntaxVersion: typeof SEARCH_SYNTAX_VERSION;
  originalQuery: string;
  normalizedQuery: string;
  root: SearchNode | null;
};

export type SearchLiteralNode = SearchTermNode | SearchPhraseNode;

export function visitSearchLiterals(
  node: SearchNode | null,
  visitor: (literal: SearchLiteralNode, negated: boolean) => void,
  negated = false,
): void {
  if (!node) return;

  switch (node.type) {
    case 'term':
    case 'phrase':
      visitor(node, negated);
      return;
    case 'not':
      visitSearchLiterals(node.operand, visitor, !negated);
      return;
    case 'and':
    case 'or':
      for (const operand of node.operands) {
        visitSearchLiterals(operand, visitor, negated);
      }
  }
}

export function evaluateSearchNode(
  node: SearchNode | null,
  matches: (literal: SearchLiteralNode) => boolean,
): boolean {
  if (!node) return true;

  switch (node.type) {
    case 'term':
    case 'phrase':
      return matches(node);
    case 'not':
      return !evaluateSearchNode(node.operand, matches);
    case 'and':
      return node.operands.every((operand) => evaluateSearchNode(operand, matches));
    case 'or':
      return node.operands.some((operand) => evaluateSearchNode(operand, matches));
  }
}

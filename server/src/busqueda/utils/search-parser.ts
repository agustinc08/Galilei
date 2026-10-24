import {
  SEARCH_SYNTAX_VERSION,
  type SearchAndNode,
  type SearchFieldName,
  type SearchLiteralNode,
  type SearchMatchMode,
  type SearchNode,
  type SearchOrNode,
  type SearchQueryAst,
  type SearchTermNode,
} from './search-ast';
import { normalizeQueryText, normalizeSearchText } from './search-normalizer';

export type ParsedSearchQuery = SearchQueryAst & {
  raw: string;
  include: string[];
  exclude: string[];
  frases: string[];
  terms: string[];
  exactPhrases: string[];
  excludedTerms: string[];
  excludedPhrases: string[];
  fieldTerms: Partial<Record<SearchFieldName, string[]>>;
};

export type ParseSearchOptions = {
  /** Legacy UI selector, applied only when q contains no explicit logical operator. */
  defaultOperator?: 'AND' | 'OR';
};

export class SearchQueryParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchQueryParseError';
  }
}

type Token =
  | {
      type: 'term' | 'phrase';
      value: string;
      sourceText: string;
      field?: SearchFieldName;
      offset: number;
    }
  | {
      type:
        | 'and'
        | 'or'
        | 'not'
        | 'legacy-and'
        | 'legacy-or'
        | 'minus'
        | 'left-paren'
        | 'right-paren';
      offset: number;
    };

const FIELD_ALIASES: Readonly<Record<string, SearchFieldName>> = {
  tema: 'tema',
  sala: 'sala',
  tipo: 'tipoFallo',
  tipofallo: 'tipoFallo',
  tribunal: 'tribunalOrigen',
  tribunalorigen: 'tribunalOrigen',
  expediente: 'expediente',
  caratula: 'caratula',
  carátula: 'caratula',
  actor: 'actor',
  demandado: 'demandado',
  objeto: 'objeto',
  magistrados: 'magistrados',
  numerosentencia: 'numeroSentencia',
  numerosumario: 'numeroSumario',
};

const FIELD_PREFIX = /^([\p{L}][\p{L}\p{N}_]*):/u;

function isSpace(value: string) {
  return /\s/u.test(value);
}

function isTermBoundary(value: string) {
  return (
    isSpace(value) ||
    value === '(' ||
    value === ')' ||
    value === '*' ||
    value === '+' ||
    value === '"'
  );
}

function cleanTerm(value: string) {
  return value.replace(/^[^\p{L}\p{N}%]+|[^\p{L}\p{N}%]+$/gu, '');
}

function parseWildcard(raw: string): {
  value: string;
  matchMode: SearchMatchMode;
} {
  const leading = raw.startsWith('%');
  const trailing = raw.endsWith('%');
  const value = raw.replace(/^%|%$/g, '');

  if (!value || value.includes('%')) {
    throw new SearchQueryParseError(
      'El comodín % solo puede aparecer al inicio o al final de un término no vacío.',
    );
  }

  return {
    value,
    matchMode:
      leading === trailing ? 'contains' : leading ? 'suffix' : 'prefix',
  };
}

function readQuoted(
  source: string,
  start: number,
): { value: string; next: number } {
  let value = '';
  let index = start + 1;

  while (index < source.length) {
    const char = source[index];
    if (char === '\\' && source[index + 1] === '"') {
      value += '"';
      index += 2;
      continue;
    }
    if (char === '"') {
      const trimmed = value.trim();
      if (!trimmed)
        throw new SearchQueryParseError(
          'La frase entre comillas no puede estar vacía.',
        );
      return { value: trimmed, next: index + 1 };
    }
    value += char;
    index += 1;
  }

  throw new SearchQueryParseError('Falta cerrar las comillas de la frase.');
}

function readTerm(
  source: string,
  start: number,
): { value: string; next: number } {
  let index = start;
  while (index < source.length && !isTermBoundary(source[index])) index += 1;
  const value = cleanTerm(source.slice(start, index));
  if (!value)
    throw new SearchQueryParseError(
      `Término vacío cerca de la posición ${start + 1}.`,
    );
  return { value, next: index };
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    if (isSpace(char)) {
      index += 1;
      continue;
    }
    if (char === '(') {
      tokens.push({ type: 'left-paren', offset: index++ });
      continue;
    }
    if (char === ')') {
      tokens.push({ type: 'right-paren', offset: index++ });
      continue;
    }
    if (char === '*') {
      tokens.push({ type: 'legacy-and', offset: index++ });
      continue;
    }
    if (char === '+') {
      tokens.push({ type: 'legacy-or', offset: index++ });
      continue;
    }
    if (char === '-') {
      tokens.push({ type: 'minus', offset: index++ });
      continue;
    }

    let field: SearchFieldName | undefined;
    const fieldMatch = source.slice(index).match(FIELD_PREFIX);
    if (fieldMatch) {
      const rawName = fieldMatch[1];
      const alias = rawName.toLocaleLowerCase('es');
      field = FIELD_ALIASES[alias];
      if (!field)
        throw new SearchQueryParseError(
          `Campo de búsqueda no admitido: ${rawName}.`,
        );
      index += fieldMatch[0].length;
      if (
        index >= source.length ||
        isSpace(source[index]) ||
        source[index] === ')' ||
        source[index] === '('
      ) {
        throw new SearchQueryParseError(
          `El campo ${rawName} necesita un valor.`,
        );
      }
    }

    if (source[index] === '"') {
      const quoted = readQuoted(source, index);
      tokens.push({
        type: 'phrase',
        value: quoted.value,
        sourceText: source.slice(
          fieldMatchStart(source, index, field),
          quoted.next,
        ),
        field,
        offset: field ? index - rawFieldLength(source, index) : index,
      });
      index = quoted.next;
      continue;
    }

    const start = index;
    const parsed = readTerm(source, start);
    index = parsed.next;
    const upper = parsed.value.toLocaleUpperCase('es');
    const operator =
      !field && (upper === 'AND' || upper === 'OR' || upper === 'NOT');
    if (operator) {
      tokens.push({
        type: upper.toLowerCase() as 'and' | 'or' | 'not',
        offset: start,
      });
      continue;
    }

    const wildcard = parseWildcard(parsed.value);
    tokens.push({
      type: 'term',
      value: wildcard.value,
      sourceText: source.slice(
        field ? start - rawFieldLength(source, start) : start,
        parsed.next,
      ),
      field,
      offset: field ? start - rawFieldLength(source, start) : start,
      // The mode is attached below without widening the token union.
      ...({ matchMode: wildcard.matchMode } as object),
    });
  }

  return tokens;
}

// These helpers recover the start of an already-consumed field prefix for explanations.
function rawFieldLength(source: string, valueStart: number) {
  const prefix = source
    .slice(0, valueStart)
    .match(/[\p{L}][\p{L}\p{N}_]*:$/u)?.[0];
  return prefix?.length ?? 0;
}

function fieldMatchStart(
  source: string,
  valueStart: number,
  field?: SearchFieldName,
) {
  return field ? valueStart - rawFieldLength(source, valueStart) : valueStart;
}

type ValueToken = Extract<Token, { type: 'term' | 'phrase' }> & {
  matchMode?: SearchMatchMode;
};

class Parser {
  private cursor = 0;
  private readonly defaultOr: boolean;

  constructor(
    private readonly tokens: Token[],
    defaultOperator: 'AND' | 'OR',
  ) {
    const hasExplicitOperator = tokens.some((token) =>
      ['and', 'or', 'not', 'legacy-and', 'legacy-or', 'minus'].includes(
        token.type,
      ),
    );
    this.defaultOr = defaultOperator === 'OR' && !hasExplicitOperator;
  }

  parse(): SearchNode | null {
    if (!this.tokens.length) return null;
    const root = this.parseOr();
    const remaining = this.peek();
    if (remaining) {
      if (remaining.type === 'right-paren')
        throw new SearchQueryParseError(
          'Hay un paréntesis de cierre sin abrir.',
        );
      throw new SearchQueryParseError(
        `No se pudo interpretar la consulta cerca de la posición ${remaining.offset + 1}.`,
      );
    }
    return root;
  }

  private parseOr(): SearchNode {
    const operands = [this.parseAnd()];
    while (true) {
      if (this.match('or') || this.match('legacy-or')) {
        this.requireExpression('OR');
        operands.push(this.parseAnd());
        continue;
      }
      if (this.defaultOr && this.canStartExpression(this.peek())) {
        operands.push(this.parseAnd());
        continue;
      }
      break;
    }
    return operands.length === 1
      ? operands[0]
      : ({ type: 'or', operands } satisfies SearchOrNode);
  }

  private parseAnd(): SearchNode {
    const operands = [this.parseUnary()];
    while (true) {
      if (this.match('and') || this.match('legacy-and')) {
        this.requireExpression('AND');
        operands.push(this.parseUnary());
        continue;
      }
      if (!this.defaultOr && this.canStartExpression(this.peek())) {
        operands.push(this.parseUnary());
        continue;
      }
      break;
    }
    return operands.length === 1
      ? operands[0]
      : ({ type: 'and', operands } satisfies SearchAndNode);
  }

  private parseUnary(): SearchNode {
    if (this.match('not') || this.match('minus')) {
      this.requireExpression('NOT');
      return { type: 'not', operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): SearchNode {
    if (this.match('left-paren')) {
      if (this.match('right-paren'))
        throw new SearchQueryParseError(
          'Los paréntesis no pueden estar vacíos.',
        );
      const expression = this.parseOr();
      if (!this.match('right-paren'))
        throw new SearchQueryParseError('Falta cerrar un paréntesis.');
      return expression;
    }

    const token = this.peek();
    if (!token || (token.type !== 'term' && token.type !== 'phrase')) {
      throw new SearchQueryParseError(this.operatorError(token));
    }
    this.cursor += 1;
    const valueToken = token as ValueToken;
    const normalizedValue = normalizeSearchText(valueToken.value);
    if (!normalizedValue)
      throw new SearchQueryParseError(
        'El término de búsqueda queda vacío al normalizarse.',
      );

    if (token.type === 'phrase') {
      return {
        type: 'phrase',
        value: valueToken.value,
        normalizedValue,
        field: valueToken.field,
        sourceText: valueToken.sourceText,
      };
    }

    return {
      type: 'term',
      value: valueToken.value,
      normalizedValue,
      field: valueToken.field,
      matchMode: valueToken.matchMode ?? 'contains',
      sourceText: valueToken.sourceText,
    } satisfies SearchTermNode;
  }

  private requireExpression(operator: string) {
    if (!this.canStartExpression(this.peek())) {
      throw new SearchQueryParseError(
        `Operador ${operator} sin término a la derecha.`,
      );
    }
  }

  private operatorError(token?: Token): string {
    if (!token) return 'La consulta termina antes de completar un operador.';
    if (token.type === 'right-paren')
      return 'Falta un término antes del paréntesis de cierre.';
    if (['and', 'legacy-and'].includes(token.type))
      return 'Operador AND sin término a la izquierda.';
    if (['or', 'legacy-or'].includes(token.type))
      return 'Operador OR sin término a la izquierda.';
    if (['not', 'minus'].includes(token.type))
      return 'Operador NOT sin término a la izquierda.';
    return `Consulta inválida cerca de la posición ${token.offset + 1}.`;
  }

  private canStartExpression(token?: Token): boolean {
    return Boolean(
      token &&
      ['term', 'phrase', 'left-paren', 'not', 'minus'].includes(token.type),
    );
  }

  private peek() {
    return this.tokens[this.cursor];
  }

  private match(type: Token['type']) {
    if (this.peek()?.type !== type) return false;
    this.cursor += 1;
    return true;
  }
}

function createLegacyProjection(root: SearchNode | null) {
  const terms: string[] = [];
  const exactPhrases: string[] = [];
  const excludedTerms: string[] = [];
  const excludedPhrases: string[] = [];
  const fieldTerms: Partial<Record<SearchFieldName, string[]>> = {};
  const walk = (node: SearchNode | null, negated = false) => {
    if (!node) return;
    if (node.type === 'not') return walk(node.operand, !negated);
    if (node.type === 'and' || node.type === 'or') {
      node.operands.forEach((operand) => walk(operand, negated));
      return;
    }
    const target =
      node.type === 'phrase'
        ? negated
          ? excludedPhrases
          : exactPhrases
        : negated
          ? excludedTerms
          : terms;
    if (!node.field) target.push(node.value);
    else if (!negated)
      fieldTerms[node.field] = [...(fieldTerms[node.field] ?? []), node.value];
  };
  walk(root);

  return {
    terms,
    exactPhrases,
    excludedTerms,
    excludedPhrases,
    fieldTerms,
  };
}

export function parseSearchQuery(
  raw?: string | null,
  options: ParseSearchOptions = {},
): ParsedSearchQuery {
  const originalQuery = raw ?? '';
  const source = originalQuery.trim();
  const tokens = tokenize(source);
  const root = new Parser(tokens, options.defaultOperator ?? 'AND').parse();
  const projection = createLegacyProjection(root);
  return {
    syntaxVersion: SEARCH_SYNTAX_VERSION,
    originalQuery,
    normalizedQuery: normalizeQueryText(originalQuery),
    root,
    raw: source,
    include: [...projection.terms],
    exclude: [...projection.excludedTerms, ...projection.excludedPhrases],
    frases: [...projection.exactPhrases],
    ...projection,
  };
}

export type { SearchLiteralNode };

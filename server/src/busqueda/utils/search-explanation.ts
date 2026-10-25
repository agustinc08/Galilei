import type { SearchFieldName, SearchNode } from './search-ast';

const FIELD_LABELS: Record<SearchFieldName, string> = {
  tema: 'tema',
  sala: 'Sala',
  tipoFallo: 'tipo de fallo',
  tribunalOrigen: 'tribunal de origen',
  expediente: 'expediente',
  caratula: 'carátula',
  actor: 'actor',
  demandado: 'demandado',
  objeto: 'objeto',
  magistrados: 'magistrados',
  numeroSentencia: 'número de sentencia',
  numeroSumario: 'número de sumario',
};

function describeLiteral(
  node: Extract<SearchNode, { type: 'term' | 'phrase' }>,
) {
  if (node.type === 'phrase') {
    const words = node.value.trim().split(/\s+/u);
    return words.length === 1
      ? `«${node.value}» entre comillas busca la palabra completa${node.field ? ` en ${FIELD_LABELS[node.field]}` : ''}.`
      : `«${node.value}» entre comillas busca esa frase exacta, en el mismo orden y sin palabras intermedias${node.field ? `, en ${FIELD_LABELS[node.field]}` : ''}.`;
  }

  const hasExplicitWildcard = node.sourceText.includes('%');
  const scope = node.field ? ` en ${FIELD_LABELS[node.field]}` : '';
  if (!hasExplicitWildcard) {
    return `«${node.value}» busca desde el inicio de una palabra; no hace falta escribir el resto de esa palabra${scope}.`;
  }
  if (node.matchMode === 'prefix') {
    return `«${node.value}%» busca palabras que comiencen con ese texto${scope}.`;
  }
  if (node.matchMode === 'suffix') {
    return `«%${node.value}» busca palabras que terminen con ese texto${scope}.`;
  }
  return `«%${node.value}%» busca ese fragmento en cualquier posición${scope}.`;
}

function describeNode(node: SearchNode): string {
  switch (node.type) {
    case 'term':
    case 'phrase':
      return describeLiteral(node);
    case 'not':
      return `Excluye los resultados que coincidan con: ${describeNode(node.operand)}`;
    case 'and':
      return `Exige que se cumplan todos estos criterios: ${node.operands.map(describeNode).join(' Y ')}`;
    case 'or':
      return `Acepta cualquiera de estos criterios: ${node.operands.map(describeNode).join(' O ')}`;
  }
}

export function explainSearchQuery(root: SearchNode | null) {
  return {
    summary: root
      ? describeNode(root)
      : 'No hay texto libre; la consulta se limita a los filtros seleccionados.',
    notes:
      'Se ignoran mayúsculas y se toleran tildes. La ñ se mantiene distinta de la n.',
  };
}

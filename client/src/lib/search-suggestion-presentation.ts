import type { SearchSuggestion } from '@/types/busqueda';

const SUGGESTION_LABELS: Record<SearchSuggestion['tipo'], string> = {
  coincidencia_exacta: 'Coincidencia exacta en tema de sumario',
  voz_juridica: 'Voz jurídica validada',
  termino_relacionado: 'Término relacionado',
  tema: 'Tema',
  magistrado: 'Magistrado',
  sala: 'Sala',
  tipoFallo: 'Tipo de fallo',
  expediente: 'Expediente',
  caratula: 'Carátula',
  libre: 'Búsqueda libre',
};

export function searchSuggestionMeta(suggestion: SearchSuggestion) {
  if (suggestion.tipo === 'termino_relacionado' && suggestion.relacion) {
    return `${SUGGESTION_LABELS[suggestion.tipo]} · ${suggestion.relacion}`;
  }
  if (suggestion.tipo === 'voz_juridica') {
    return SUGGESTION_LABELS[suggestion.tipo];
  }
  if (suggestion.total !== undefined) {
    return `${SUGGESTION_LABELS[suggestion.tipo]} · ${suggestion.total} registros`;
  }
  return SUGGESTION_LABELS[suggestion.tipo];
}

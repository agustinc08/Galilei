import type { ConsultaPublicaFilters } from '../types/busqueda';

export const PUBLIC_SEARCH_STATE_KEYS = [
  'q',
  'fraseExacta',
  'excluir',
  'operador',
  'tema',
  'sala',
  'salas',
  'fechaDesde',
  'fechaHasta',
  'tipoFallo',
  'tribunalOrigen',
  'numeroSumario',
  'numeroSentencia',
  'magistrados',
  'caratula',
  'expediente',
  'actor',
  'demandado',
  'objeto',
  'anio',
  'soloConPdf',
  'pdf',
  'tienePdf',
  'buscarEn',
  'sortBy',
  'sortOrder',
  'page',
  'pageSize',
] as const satisfies readonly (keyof ConsultaPublicaFilters)[];

export type PublicSearchState = Partial<ConsultaPublicaFilters>;

export function canonicalPublicSearchPath(search: URLSearchParams) {
  const params = new URLSearchParams();
  for (const key of PUBLIC_SEARCH_STATE_KEYS) {
    if (key === 'salas') {
      const values = [...new Set(search.getAll(key).map((value) => value.trim()).filter(Boolean))];
      for (const value of values) params.append(key, value);
      continue;
    }
    const value = search.get(key)?.trim();
    if (!value) continue;
    if (key === 'operador' && value === 'AND') continue;
    if (key === 'page' && value === '1') continue;
    if (key === 'pageSize' && value === '25') continue;
    params.set(key, value);
  }
  const query = params.toString();
  return `/consulta${query ? `?${query}` : ''}`;
}

export function publicSearchStateFromUrl(search: URLSearchParams): PublicSearchState {
  const state: Record<string, string | number | string[]> = {};
  for (const key of PUBLIC_SEARCH_STATE_KEYS) {
    if (key === 'salas') {
      const values = [...new Set(search.getAll(key).map((value) => value.trim()).filter(Boolean))];
      if (values.length) state[key] = values;
      continue;
    }
    const value = search.get(key)?.trim();
    if (!value) continue;
    if (key === 'page' || key === 'pageSize' || key === 'anio') {
      const numeric = Number(value);
      if (Number.isInteger(numeric)) state[key] = numeric;
      continue;
    }
    state[key] = value;
  }
  return state as PublicSearchState;
}

export function publicSearchPathFromSaved(queryJson: Record<string, unknown>) {
  if (queryJson.kind !== 'consulta-publica' || queryJson.version !== 1) return null;
  const savedState = queryJson.state;
  if (typeof savedState !== 'object' || savedState === null || Array.isArray(savedState)) return null;

  const params = new URLSearchParams();
  const state = savedState as Record<string, unknown>;
  for (const key of PUBLIC_SEARCH_STATE_KEYS) {
    const value = state[key];
    if (key === 'salas' && Array.isArray(value)) {
      const values = [...new Set(value.flatMap((entry) => {
        if (typeof entry !== 'string') return [];
        const normalized = entry.trim();
        return normalized && isValidSavedValue(key, normalized) ? [normalized] : [];
      }))];
      for (const entry of values) params.append(key, entry);
      continue;
    }
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
    const normalized = String(value).trim();
    if (!normalized) continue;
    if (!isValidSavedValue(key, normalized)) continue;
    params.set(key, normalized);
  }
  const query = params.toString();
  return `/consulta${query ? `?${query}` : ''}`;
}

function isValidSavedValue(key: typeof PUBLIC_SEARCH_STATE_KEYS[number], value: string) {
  if (key === 'salas') return value.length > 0 && value.length <= 160;
  if (key === 'operador') return value === 'AND' || value === 'OR';
  if (key === 'sortOrder') return value === 'asc' || value === 'desc';
  if (key === 'sortBy') return ['fecha', 'relevancia', 'sala', 'numeroSentencia'].includes(value);
  if (key === 'pdf') return ['todos', 'conPdf', 'sinPdf'].includes(value);
  if (key === 'soloConPdf' || key === 'tienePdf') return value === 'true' || value === 'false';
  if (key === 'buscarEn') return ['todo', 'sentencia', 'sumario', 'resena', 'referencias'].includes(value);
  if (key === 'page' || key === 'pageSize') {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 1 && (key !== 'pageSize' || numeric <= 300);
  }
  if (key === 'anio') {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 1900 && numeric <= 2100;
  }
  if (key === 'fechaDesde' || key === 'fechaHasta') {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  return true;
}

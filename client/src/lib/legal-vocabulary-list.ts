export type LegalVocabularyListEntry = {
  nombre: string;
  descripcion?: string | null;
  materia?: string | null;
  fuente?: string | null;
  identificadorFuente?: string | null;
  estadoValidacion?: 'PENDIENTE_REVISION' | 'APROBADO' | 'RECHAZADO';
  activo: boolean;
  sinonimos?: Array<{
    termino: string;
    activo: boolean;
    fuente?: string | null;
    identificadorFuente?: string | null;
    estadoValidacion?: 'PENDIENTE_REVISION' | 'APROBADO' | 'RECHAZADO';
  }>;
};

export type LegalVocabularyStatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

const ENYE_SENTINEL = '\uE000';

export function normalizeLegalVocabularyText(value: string) {
  return value
    .toLocaleLowerCase('es')
    .replace(/ñ/gu, ENYE_SENTINEL)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(new RegExp(ENYE_SENTINEL, 'gu'), 'ñ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function filterLegalVocabulary<T extends LegalVocabularyListEntry>(
  entries: T[],
  query: string,
  status: LegalVocabularyStatusFilter,
) {
  const normalizedQuery = normalizeLegalVocabularyText(query);

  return entries.filter((entry) => {
    if (status === 'ACTIVE' && !entry.activo) return false;
    if (status === 'INACTIVE' && entry.activo) return false;
    if (!normalizedQuery) return true;

    const searchable = [
      entry.nombre,
      entry.descripcion ?? '',
      entry.materia ?? '',
      entry.fuente ?? '',
      entry.identificadorFuente ?? '',
      ...(entry.sinonimos ?? []).flatMap((sinonimo) => [
        sinonimo.termino,
        sinonimo.fuente ?? '',
        sinonimo.identificadorFuente ?? '',
      ]),
    ]
      .map(normalizeLegalVocabularyText)
      .join(' ');

    return searchable.includes(normalizedQuery);
  });
}

export function findLegalVocabularyMatches(
  entries: LegalVocabularyListEntry[],
  candidate: string,
) {
  const normalizedCandidate = normalizeLegalVocabularyText(candidate);
  if (!normalizedCandidate) return [];

  const matches: Array<{
    term: string;
    relation: 'voz' | 'equivalencia';
  }> = [];

  for (const entry of entries) {
    if (normalizeLegalVocabularyText(entry.nombre) === normalizedCandidate) {
      matches.push({ term: entry.nombre, relation: 'voz' });
      continue;
    }

    for (const sinonimo of entry.sinonimos ?? []) {
      if (
        normalizeLegalVocabularyText(sinonimo.termino) === normalizedCandidate
      ) {
        matches.push({ term: sinonimo.termino, relation: 'equivalencia' });
      }
    }
  }

  return matches;
}

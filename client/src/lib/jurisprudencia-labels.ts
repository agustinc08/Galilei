const TYPE_LABELS: Record<string, string> = {
  DOCUMENT: 'Fallo civil',
  DOCUMENTO: 'Fallo civil',
  JURISPRUDENCIA: 'Fallo civil',
  SENTENCIA: 'Sentencia',
  INTERLOCUTORIA: 'Sentencia interlocutoria',
  RESOLUCION: 'Resolución',
  RESOLUCIÓN: 'Resolución',
};

export function formatTipoFallo(value?: string | null) {
  if (!value?.trim()) return '';
  const normalized = value.trim().replace(/[_-]+/gu, ' ');
  return TYPE_LABELS[normalized.toLocaleUpperCase('es-AR')] ?? normalized;
}

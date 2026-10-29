const STRATEGY_LABELS: Record<string, string> = {
  EXACT_LEGACY_ID_OR_SENTENCE_NUMBER_FILENAME:
    'Coinciden el identificador o número de sentencia y el nombre del archivo.',
};

export function confidenceLabel(value: string) {
  if (value === 'HIGH_CONFIDENCE') return 'Coincidencia alta';
  if (value === 'MEDIUM_CONFIDENCE') return 'Coincidencia probable';
  if (value === 'CANDIDATE') return 'Coincidencia posible';
  return 'Sugerencia para revisar';
}

export function evidenceLabel(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return 'Comprobá el documento fuente y el destino sugerido antes de decidir.';
  const strategies = (value as Record<string, unknown>).strategies;
  if (Array.isArray(strategies)) {
    const translated = strategies
      .filter((strategy): strategy is string => typeof strategy === 'string')
      .map((strategy) => STRATEGY_LABELS[strategy])
      .filter(Boolean);
    if (translated.length) return [...new Set(translated)].join(' ');
  }
  return 'Hay datos de coincidencia para revisar en el documento fuente y el destino sugerido.';
}

export function reviewStatusLabel(value: string) {
  if (value === 'REVIEW_PENDING') return 'Pendiente de revisión humana';
  if (value === 'APPROVED') return 'Aprobado';
  if (value === 'REJECTED') return 'Rechazado';
  return 'Revisión humana requerida';
}

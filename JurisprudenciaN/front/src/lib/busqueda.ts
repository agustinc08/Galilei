export function limpiarFiltrosBusqueda(form: object) {
  const cleaned: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(form)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed || trimmed === 'todos') {
        continue;
      }
      cleaned[key] = trimmed;
      continue;
    }

    cleaned[key] = value as string | number | boolean;
  }

  if (cleaned.soloConPdf === 'true' && !cleaned.pdf) {
    cleaned.pdf = 'conPdf';
  }

  delete cleaned.soloConPdf;
  delete cleaned.tienePdf;

  return cleaned;
}

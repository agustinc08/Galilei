export function corpusDocumentStatusLabel(status?: string | null) {
  if (status === 'INDEXED') return 'Listo para buscar';
  if (status === 'TEXT_EXTRACTED') return 'Texto disponible';
  if (status === 'EXTRACTED_TRUNCATED') return 'Texto parcial disponible';
  if (status === 'OCR_REQUIRED') return 'Requiere reconocimiento de texto';
  if (status === 'OCR_PROCESSING') return 'Procesando OCR…';
  if (
    status === 'OCR_FAILED' ||
    status === 'EXTRACTION_FAILED' ||
    status === 'ERROR' ||
    status === 'INVALID_PDF'
  ) {
    return 'No se pudo extraer el texto';
  }
  if (status === 'INDEX_PENDING') return 'Indexación pendiente';
  if (status === 'PENDING' || status === 'DISCOVERED') {
    return 'Procesamiento pendiente';
  }
  return status ? 'Estado no disponible' : 'Documento disponible';
}

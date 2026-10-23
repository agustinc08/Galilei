# 38 — Extracción de texto y páginas

## Contrato y formatos

`DocumentTextExtractor.extract(filename, mimeType, content)` está separado del pipeline y de controllers. `BasicDocumentTextExtractor` implementa TXT UTF-8 y PDF con capa de texto mediante `pdf-parse` 2.4.5. DOCX y OCR no se ejecutan.

Cada extracción conserva extractor/versión, fecha, estado, texto completo y relación a sus páginas. PDF produce páginas físicas numeradas desde 1. TXT produce una página lógica. La búsqueda puede devolver el número de la primera página que contiene un literal positivo coincidente.

## Clasificación y errores

- Hay texto extraíble: `TEXT_EXTRACTED`; texto/páginas quedan almacenados y pasan a la proyección de búsqueda.
- No hay capa textual (PDF vacío/escaneado): `OCR_REQUIRED`; no se indexa como fallo de lectura.
- Parser/formato falla: `EXTRACTION_FAILED` con etapa, error, fecha y retryable; el original no se borra.

Fixture sintético validado: PDF de dos páginas con `JORGE PORCEL FIXTURE` en página 2, PDF sin texto, PDF/TXT de duplicación y cambio de contenido. No se empleó material confidencial. La API habilita reintento de extracción; revisión/OCR y versionado complejo siguen pendientes.

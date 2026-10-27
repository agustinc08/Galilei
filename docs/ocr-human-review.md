# Revisión OCR

Sprint 8 agrega una cola interna para documentos del Corpus con estado `OCR_REQUIRED`. El recorrido separa el PDF judicial original, el texto OCR candidato, la corrección humana y el texto aprobado para búsqueda.

## Uso

1. Abrir **Jurisprudencia → Revisión OCR** en `/admin/jurisprudencia/ocr`.
2. Elegir un documento y tomar la revisión. La cola permite filtrar pendientes, asignados y listos para aprobación, y pagina los resultados desde el servidor.
3. Comparar cada página del PDF original con **Texto OCR**. Corregir en **Texto corregido** y guardar explícitamente.
4. Usar **Aprobar página**, **Sin texto** o **Requiere nueva revisión**. Cada decisión se guarda por página y conserva quién la hizo y cuándo.
5. Cuando todas las páginas estén aprobadas o confirmadas sin texto, revisar el resumen y usar **Aprobar texto del documento**.

## Qué cambia al aprobar

La aprobación final crea una extracción canónica nueva y actualiza el texto interno del Corpus. El mecanismo existente agrega el evento a Search outbox para que OpenSearch lo proyecte. Si Search está indisponible, PostgreSQL conserva la aprobación y el outbox queda pendiente para la siguiente reconciliación.

La aprobación OCR no publica el fallo, no cambia metadatos jurídicos, no modifica citas ni confirma referencias. El PDF original conserva sus bytes y SHA-256. El OCR y las correcciones permanecen como datos derivados con procedencia e historial.

## Estados y permisos

Las páginas pueden quedar pendientes, listas para revisar, aprobadas, confirmadas sin texto, rechazadas, reabiertas o fallidas. La revisión del documento se mantiene separada de su publicación. El acceso está limitado a ADMIN, OPERADOR, REVISOR y JURISPRUDENCIA, sujeto además a la autorización sobre el documento. LECTOR no puede revisar ni aprobar.

Los detalles de la integración con Corpus, la procedencia y el outbox están en [`ocr-human-review-architecture.md`](ocr-human-review-architecture.md). La guía para revisión institucional está en [`uat-ocr-review.md`](uat-ocr-review.md).

## Alcance de certificación

La certificación técnica de Sprint 8 usa PostgreSQL 16, OpenSearch 2.19.6, Tesseract/Poppler locales y documentos sintéticos dentro de servicios aislados. La revisión humana institucional y la decisión de despliegue siguen pendientes; no se usaron etiquetas OCR como gold del parser.

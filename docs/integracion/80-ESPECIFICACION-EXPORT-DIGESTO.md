# Especificación del export local del Digesto — Sprint 11

**Estado: DISEÑADO; no se encontró un export autorizado de metadata ni se implementa un conector remoto.** Antes de importar metadatos debe entregarse un paquete local autorizado con manifiesto, checksum y dueño institucional identificado.

## Paquete recomendado

ZIP UTF-8, sin rutas absolutas ni traversal, con `manifest.json`, `documents.csv` (o JSONL), `collections.csv`, `topics.csv`, `tags.csv`, `memberships.csv`, `relations.csv` y carpeta `files/`. El manifiesto declara versión de esquema, fecha, zona horaria, institución productora, responsable, política de licencia/retención y hash SHA-256 de cada archivo. Los CSV usarán encabezados estables, comillas RFC 4180 y fechas ISO 8601.

Campos mínimos por documento: `source_id` estable del sistema de origen, tipo, título, carátula/expediente cuando corresponda, tribunal, sala, fechas, jurisdicción, sumario, URL/fuente original, visibilidad propuesta, estado editorial, checksum del PDF, nombre lógico del archivo, conteo de páginas, estado de OCR y referencias relacionadas. Los IDs se conservan como `externalId`; nunca se infieren del nombre del archivo.

Colecciones, temas y etiquetas deben tener IDs estables, nombres, estado, orden y relaciones con documentos. Cada relación debe indicar `source_id`, `target_source_id`, tipo, vigencia y fuente de la relación. Las restricciones de ACL y publicación son explícitas y requieren aprobación del dueño de datos; el importador no convierte `PUBLIC` por defecto.

## Validaciones previas

1. Validar firma/entrega y checksum antes de extraer; rechazar traversal, symlinks y archivos sobredimensionados.
2. Validar versión, encoding, encabezados, tipos, unicidad de IDs y referencias huérfanas.
3. Comparar SHA-256 con el manifiesto y el PDF; no modificar originales.
4. Generar reporte dry-run con altas, cambios, duplicados, faltantes y conflictos; el dry-run no escribe DB.
5. Requerir aprobación del responsable antes de importar a DEV; escribir procedencia y auditoría, con idempotencia por `source_id` y checksum.
6. Resolver crosswalk explícito; no asociar IDs de Jurisprudencia/Digesto por semejanza textual.

## Límites actuales

El lote Sprint 10 tiene 278 PDFs físicos, 276 hashes únicos y 276 documentos importados en DEV, pero no incluye crosswalk de IDs, temas, tags ni ACL editorial. La importación no representa completitud del Digesto ni autorización de publicación. No conectar a Digesto remoto.

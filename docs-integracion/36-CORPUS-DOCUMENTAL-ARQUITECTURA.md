# 36 — Arquitectura del Corpus Documental Civil

**Estado:** IMPLEMENTADO en DEV; no es todavía un servicio de publicación/descarga ni una integración de CIJ.

## Decisión de dominio

El Corpus administra documentos, binarios, texto y procedencia. No reemplaza `Sentencia`, `Sumario`, el dominio Digesto ni la selección editorial de Secretaría. La relación con esos dominios queda preparada por referencia estable `CorpusDocument.id`; no se duplica el archivo al curar o clasificar un documento.

## Entidades Prisma

- `CorpusSourceSystem`: código/nombre/tipo administrables, estado, URL base y metadata sin secretos.
- `CorpusIngestionRecord`: evento rastreable con fuente, ID/URL/referencia externa, fechas, checksum, nombre/ruta relativa, metadata original, estado, idempotency key y error de etapa.
- `CorpusDocument`: identidad documental con tipo, jurisdicción, tribunal, sala, instancia, expediente, fecha, metadata normalizada/original, visibilidad, estado y proyección `searchText`.
- `CorpusDocumentFile`: referencia de almacenamiento externa a PostgreSQL, MIME, tamaño, SHA-256 y versión. `UNIQUE(documentId, sha256)` impide el mismo binario duplicado dentro del mismo documento.
- `CorpusExtraction`: texto y versión de extractor por archivo; estados `TEXT_EXTRACTED`, `OCR_REQUIRED` y `EXTRACTION_FAILED`.
- `CorpusDocumentPage`: texto por página ligado a una extracción, con `UNIQUE(extractionId, pageNumber)`.
- `CorpusDocumentLink`: relación polimórfica con un dominio/tipo/ID externo y clase de vínculo. No mueve ownership ni agrega claves foráneas hacia Jurisprudencia o Digesto; admite selección y membresía de colección sin duplicar el binario.

No se almacena el binario en PostgreSQL. Una nueva versión del mismo `source + externalId` conserva el `CorpusDocument` y agrega un archivo/version; un evento idéntico devuelve la ingesta existente. Igual SHA-256 en documentos distintos conserva sus identidades documentales, aunque el storage físico content-addressed comparte una sola copia. Igual nombre con bytes distintos genera checksums distintos.

## ACL

`visibility` distingue `PUBLIC`, `INTERNAL` y `RESTRICTED`, separada del estado de curaduría. La búsqueda admite acceso PUBLIC (sólo PUBLIC), INTERNAL (PUBLIC+INTERNAL) y ADMIN (las tres); se aplica en SQL antes del total y de los resultados. La autenticación institucional y una matriz por usuario/grupo quedan pendientes antes de exponer lecturas o descargas.

## Migraciones

Se agregaron `20261007170000_corpus_documental`, `20261007173000_corpus_latest_extraction_relation`, `20261007180000_corpus_search_trgm_index` y `20261007190000_corpus_cross_domain_links`, sin editar migraciones anteriores. En DEV: diez migraciones aplicadas, 29 tablas y extensión `pg_trgm 1.6`.

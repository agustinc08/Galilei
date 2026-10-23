# 39 — Integración de Corpus con Search

## Proyección y contrato

`CorpusDocument.searchText` es el read model reconstruible a partir de título, metadatos y última extracción. `CorpusSearchSourceAdapter` implementa el `SearchSourceAdapter` común y consume el mismo `SearchQueryAst` de `search-parser.ts`; no crea parser ni gramática paralelos. `SearchResult.sourceSystem` admite `CORPUS`, `sourceType` usa `DOCUMENTO` y `SearchContext.sourceSystems` permite excluir Corpus en composición futura.

Search cubre texto extraído, título/subtítulo y los campos de procedencia/organización incorporados a la proyección. Devuelve título, fecha, tribunal, sala/instancia, snippet, nombre/ID de archivo, checksum, source code, external ID/referencia y página. El índice `CorpusDocument_searchText_trgm_idx` es GIN `pg_trgm` parcial para estado `INDEXED`; el SQL usa parámetros enlazados y visibilidad en el `WHERE` antes de COUNT y filas.

## ACL, snippet y navegación

Se probó que una fila `RESTRICTED` no aparece ni incrementa el total público. El snippet y la página salen del texto extraído. `document.href` se mantiene `null` hasta implementar endpoint autenticado de lectura/descarga; los IDs de documento y archivo se devuelven como referencias estables en resultado/metadata. No hay UI de preview, siguiente/anterior ni búsqueda dentro del PDF en M6.

## Límite funcional

El adapter queda implementado y probado directamente contra PostgreSQL DEV con el AST compartido, pero el endpoint actual de búsqueda Jurisprudencia todavía no hace fan-out entre sus resultados y Corpus/Digesto. Esa integración API y sus políticas institucionales de ACL deben cerrarse antes de habilitar búsqueda común a usuarios.

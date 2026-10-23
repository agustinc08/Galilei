# 99 — Root cause de Search (Sprint 12.1)

**Fecha:** 2026-10-08 · **Entorno:** DEV local PostgreSQL 16.15, `127.0.0.1:55432` · **Estado:** causa identificada; gate sigue bloqueado.

## JURISPRUDENCIA

El endpoint ejecuta `BusquedaService.performSearch` con un `where` Prisma grande: árbol AST convertido a varios `OR` sobre campos de `Sentencia`, subconsultas relacionales de `Sumario` y tres tablas de referencias. Después pide hasta 500 sentencias y carga hasta 20 sumarios por sentencia, PDFs, conteos y referencias para puntuar el conjunto en Node. El mismo predicado se expande para términos booleanos; el costo dominante medido es `candidateQueryMs`, seguido por puntuación en memoria.

El EXPLAIN real sanitizado del fingerprint `84455fc3d623270c` devolvió 500 filas en 1.15 s en esa ejecución aislada. El nodo más caro fue `Seq Scan Sumario`: 25.138 filas vivas aproximadas, 20.290 descartadas, ~1.128 ms; luego `Index Scan Sentencia_pkey` leyó 11.348 bloques. Los `Seq Scan` de tablas de referencias estaban vacíos y no fueron el costo dominante. La variación de benchmark fue mayor: el predicado Prisma midió p50 de 5.1 s para TERM común, 6.9 s para PHRASE, 8.1 s AND y 13.0 s para BOOLEAN complejo. Índices trigram existentes no evitaron el scan porque la combinación de ramas relacionales y `OR` cambia el plan.

## CORPUS

El SQL de conteo usa `CorpusDocument.searchText ILIKE`; PostgreSQL sí entra por `CorpusDocument_searchText_trgm_idx`, pero el bitmap recheck lleva 5.453 TIDs a 4.281 documentos. En EXPLAIN el heap scan y recheck costaron 3.135 s para COUNT. La consulta de página repite el recheck y ordena los 4.281 candidatos antes de `LIMIT 10`; costó 12.309 s (`Sort` encima de `Bitmap Heap Scan`). No se observó join de las 96.375 páginas en esta consulta concreta. El tamaño medio de `searchText` es 18.114 bytes, p95 63.847 y máximo 381.716; el heap y el recheck de texto grande son el costo real aunque el bitmap index scan sea ~2 ms.

Un GIN temporal sobre texto de página ocupó 124 MB y no resolvió el plan completo. Un índice de orden no fue elegido por el planner. Ambos experimentos fueron revertidos; no queda ninguno de esos índices de experimento. La migración conserva su historia create/drop para que migrate-from-zero reproduzca el estado final.

## Evidencia

- `_recovery-work/sprint121/performance/legacy-explain.json`
- `_recovery-work/sprint121/performance/explain-summary.json`
- `_recovery-work/sprint121/performance/search-benchmark.json` y subdirectorios `before/` y `after/`
- El EXPLAIN y los benchmarks no persisten SQL, parámetros ni texto de consulta; identifican las consultas por fingerprint.

**Conclusión:** son dos causas distintas: el `OR` relacional y la carga anticipada de relaciones en JURISPRUDENCIA; recheck de texto documental grande más ordenamiento de miles de candidatos en CORPUS. Las optimizaciones probadas no redujeron el costo a umbral de preproducción.

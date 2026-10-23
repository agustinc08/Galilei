# Search performance — Sprint 12

**Estado: NOT PASS.** Medición de handler en DEV con PostgreSQL 16.15 local, 1 calentamiento y 10 muestras por familia. No se persistieron textos de consulta. Artefactos: `_recovery-work/sprint12/performance/{baseline,after}/search-benchmark.json`; planes en `before/` y `after/`.

## Antes y después

Milisegundos p50 / p95 / máximo del handler. La comparación usa el mismo corpus y familias; topic/tag aún no tenían asociaciones elegibles y no se midieron con datos reales.

| Familia | Antes p50/p95 | Después p50/p95 | Lectura |
|---|---:|---:|---|
| TERM común | 6.624 / 7.291 s | 6.819 / 6.968 s | Sin mejora material |
| TERM raro | 7.126 / 7.269 s | 7.156 / 7.289 s | Sin mejora |
| PHRASE | 8.027 / 8.272 s | 7.945 / 8.054 s | Sigue fuera de objetivo |
| AND | 13.516 / 13.920 s | 13.579 / 14.367 s | Sigue fuera de objetivo |
| OR | 13.277 / 13.487 s | 13.104 / 13.525 s | Sigue fuera de objetivo |
| NOT con positivo | 13.959 / 14.476 s | 13.901 / 14.254 s | Sigue fuera de objetivo |
| NOT sin positivo | 7.361 / 7.557 s | 7.374 / 7.475 s | Sigue fuera de objetivo |
| FIELD | 892 / 1.042 ms | 884 / 912 ms | Aceptable en esta muestra |
| PREFIX | 6.365 / 6.612 s | 6.314 / 7.541 s | Sin mejora |
| SUFFIX | 4.044 / 4.072 s | 4.050 / 4.070 s | Lento |
| SHORT TERM | 4.041 / 5.011 s | 5.006 / 5.011 s | Lento |
| IDENTIFIER EXACT | 14.8 / 15.3 ms | 14.8 / 17.0 ms | Rápido |
| COLLECTION FILTER | 6.837 / 6.912 s | 5.007 / 5.014 s | p50 baja 26,8%; aún lento |
| ZERO RESULT | 6.920 / 7.147 s | 6.923 / 7.105 s | Legacy domina pese a cero resultados |
| COMPLEX BOOLEAN | 20.317 / 20.736 s | 20.250 / 20.709 s | Peor familia |

Valores máximos detallados están en los JSON adjuntos; la muestra no representa un SLA. El nuevo parámetro topic/tag tiene tests de SQL parametrizado, pero no hay asociación activa en el corpus DEV que permita un benchmark de resultado.

## Causa y planes

La etapa parser queda alrededor de 0,01 ms y merge/ranking entre 0–1 ms. La búsqueda heredada sigue dominando, con `count` y `findMany` Prisma sobre campos de sumarios, texto normalizado y relaciones. En Corpus, el GIN `CorpusDocument_searchText_trgm_idx` se utiliza, pero COUNT y verificación de frase/NOT recorren miles de candidatos. El count de NOT positivo en EXPLAIN fue aproximadamente 22,9 s. En consulta vacía, el plan final se mantiene sub-ms.

EXPLAIN ANALYZE de la página común pasó de ~67.724 a ~26.312 shared hits en la muestra capturada. El CTE ordena y limita IDs antes de enriquecer; los subplanes correlacionados bajan de 4.281 a 10 loops. El tiempo de página sigue ~11,5 s en el EXPLAIN diagnóstico, y el handler completo queda limitado por legacy/federación. No se añadió índice: los índices GIN/trigram y de membresía existentes están presentes y no apareció evidencia que justificase duplicarlos.

## Cambios aplicados

1. Filtros de colección, tema y etiqueta usan Corpus como fuente filtrada y no disparan la consulta legacy costosa cuando se pide explícitamente un filtro Digesto. Tema/etiqueta llegan como parámetros SQL.
2. La página Corpus selecciona primero IDs y limita resultados antes de ejecutar enriquecimiento de archivo, extracción, ingesta y taxonomía.
3. Se agregó log lento configurable (`BJC_SLOW_SEARCH_MS`, default 1.500 ms, rango 100–60.000) con requestId, ruta plantilla, estado y duración; no registra query/body.

El filtro de colección fue la única mejora material observada (p50 6,84 s → 5,01 s). Los demás casos muestran ruido o no cambio. No se alteró el contrato de total exacto ni se relajó timeout/runtime para mejorar artificialmente la medición.

## Paridad

El archivo histórico Sprint 5.3 conserva **40/40 PASS_COMPAT** y fue generado 2026-10-07. Sprint 12 intentó repetir el benchmark SQLite↔PostgreSQL bajo guard DEV, pero una sentencia excedió `statement_timeout`; no generó artefacto nuevo. Por ello 40/40 es evidencia histórica, no revalidación posterior a los cambios. El benchmark histórico no fue sobrescrito.

## Dictamen

Search no satisface el gate técnico. Sprint 12.1 debe perfilar/reemplazar el camino legacy y reducir candidatos Corpus para frase/NOT, preservando paridad antes de aceptar cambios. No publicar como preproducción compartida.

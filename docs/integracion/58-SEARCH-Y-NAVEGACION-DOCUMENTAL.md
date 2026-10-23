# 58 — Search y navegación documental con datos reales

## Smoke real

Run `90f64ee1-2dac-44b1-b3dc-59df4368a287`; consulta `caratula:"30986" AND correspondiente` sobre Corpus DEV:

- 1 resultado y total 1; snippet tomado del texto extraído.
- `searchPage=1`, `selectedPage=1`; 1 coincidencia con contexto de página.
- Archivo devuelto: 76.578 bytes; checksum SHA-256 verificado; visibilidad `INTERNAL`.
- Medición del adapter tras optimización: 36 ms para este caso reproducible.

La consulta se acota por un término de carátula exacta y una palabra de la página para verificar el flujo de punta a punta. No representa p95/SLO ni prueba de carga.

## Plan y ajuste de índice

Antes del índice de carátula, `EXPLAIN (ANALYZE, BUFFERS)` del filtro de ese documento mostraba 3.613,8 ms, 39.719 buffers y 1.253 heap blocks; el GIN de `searchText` hallaba 9.699 candidatos antes de descartar por carátula. Se añadió migration `20261007220000_sprint8_corpus_title_trgm` con GIN trigram sobre `translate(lower(coalesce(title,'')), 'áéíóúü','aeiouu')`, expresión usada por el filtro estructurado. Después: 0,333 ms, 34 buffers, 1 heap block, 1 candidato en el índice de carátula. El SQL del campo full-text ahora usa la columna `searchText` normalizada directamente para habilitar su GIN. Migration aplicada sólo a DEV; el smoke cayó a 36 ms.

## Fan-out, procedencia y permisos

El endpoint moderno conserva parser/AST y federación aditiva Jurisprudencia+Corpus. `FederatedSearchService` consulta adapters en paralelo; prueba unitaria incluida en suite. El resultado del smoke demuestra la rama Corpus; no se ejecutó un HTTP autenticado con sesión de usuario ni se afirma que el caso de prueba haya medido una búsqueda real conjunta contra ambas fuentes. El Search adapter filtra visibilidad en SQL antes del total/snippet; visibilidad del documento probado: INTERNAL. Procedencia incluye código de fuente, externalId, sourceReference, nombre y checksum.

Los endpoints de metadata/archivo/matches verifican ACL antes de devolver datos y ocultan existencia no autorizada. Una página se navega con el parámetro `#page=` del visor PDF; coincidencias dan contexto y anterior/siguiente. El límite actual de coincidencias es 500 y se informa `truncated`.

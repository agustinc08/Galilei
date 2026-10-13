# Performance end-to-end — Sprint 11

**Estado: MEDIDO en DEV (n=3 por caso, una corrida).** La medición separa búsqueda legacy, búsqueda federada, parser, latencia por adapter, conteo, página SQL, serialización, merge/ranking y total de handler. No registra términos ni resultados.

## Método

El script `JurisprudenciaN/back/scripts/dev/sprint11-search-profile.ts` se ejecuta mediante el guard `sprint11-search-profile`, que confirma loopback/puerto/DB/rol DEV. Usa cinco casos: cero resultados, término raro, operador NOT, filtro selectivo de colección y frase. Cada caso ejecuta una solicitud de calentamiento y tres mediciones; se reportan p50/p95/máximo. La muestra es pequeña y secuencial: sirve para localizar cuellos de botella, no para declarar SLO o capacidad productiva.

| Caso | n | p50 | p95 | máximo | Estado |
|---|---:|---:|---:|---:|---|
| Sin resultados | 3 | 1.459 s | 6.686 s | 6.686 s | |
| Término raro | 3 | 4.575 s | 7.042 s | 7.042 s | |
| NOT | 3 | 12.905 s | 13.107 s | 13.107 s | |
| Filtro de colección | 3 | 6.899 s | 6.971 s | 6.971 s | |
| Frase | 3 | 7.957 s | 7.987 s | 7.987 s | |

Valores del total del handler de la corrida final. Legacy dominó: p50 de cero 1,46 s, raro 3,40 s, NOT 12,90 s, filtro 6,90 s y frase 7,96 s; los p95 respectivos están en la tabla. Federada: 4,56 ms, 4,01 s, 4,04 s y ~5 s en filtro/frase. Parser 0,01–0,03 ms; merge/ranking 0–1 ms. Jurisprudencia count/página generalmente <40 ms. Corpus raro completó count/page en ~0,93/0,94 s (perfil n=2); consulta NOT usó ~4,05 s. Filtro/frase expiraron el tiempo federado. Los perfiles adapter para operaciones incompletas quedan nulos tras reset al comienzo de cada llamada, sin reutilizar la última medición.

Un primer intento permitió que consultas SQL siguieran tras el timeout de la federación; se agregó `statement_timeout` de PostgreSQL configurable (`BJC_SEARCH_STATEMENT_TIMEOUT_MS`, default 4.000 ms; máximo 4.500 ms), menor que el límite federado de 5 s, para cancelar el trabajo de servidor. La corrida final de perfil ya incluye este control. Las latencias completas muestran que la búsqueda legacy sigue siendo un gate de rendimiento.

`EXPLAIN ANALYZE` del conteo representativo superó el límite de seguridad de 6 s (`57014 query_canceled`). Se guardó plan estimado de cuatro formas con strings sintéticos en `_recovery-work/sprint11/performance/explain-summary.json`: zero/phrase/NOT usan `CorpusDocument_searchText_trgm_idx` según el estimador; el filtro de colección añade Hash Join/scan de membresías. Es un plan estático simplificado de página y no reemplaza un `EXPLAIN ANALYZE` del SQL completo; no se agregó ningún índice con esta evidencia.

## Interpretación / acciones

El benchmark debe repetir sobre un universo equivalente de datos y anotar tamaño/hash del fixture. No comparar con métricas de Sprint 10 que miden acciones UI diferentes. Para consultas lentas, conservar plan `EXPLAIN ANALYZE` sanitizado, revisar cardinalidad e índices antes de proponer cambios. El tablero hace cinco requests HTTP en paralelo y `institutionalSummary` ejecuta 18 agregaciones independientes en paralelo; no se observó consulta por fila (N+1), pero la ráfaga de 18 consultas merece medición y posible consolidación. No persistir texto de consultas o parámetros sensibles en logs.

**Límite:** estos valores no son concurrencia, SLA ni latencia de red de preproducción.

# Search V2 — estado operativo

**Vigente:** implementación y medición Sprint 14.9.1 en DEV local (2026-10-13). PHRASE conserva el resultado literal y reutiliza candidatos entre ventanas, pero la latencia del benchmark comparable empeoró y p95 sigue sobre 1.200 ms; estado PARTIAL / PHRASE REGRESSION REMAINS.

## Arquitectura

- Endpoint: `/api/busqueda/avanzada`, servido por Search V2 en las mediciones actuales.
- Backend: AST común, selección de candidatos, late hydration y adaptadores federados de Jurisprudencia y Corpus. ACL se aplica antes del conteo y de los resultados.
- `CorpusSearchToken` es proyección derivada; no reemplaza el texto jurídico. Search conserva el fallback exacto si la proyección no está lista. No se reconstruye al iniciar la aplicación.
- Viewer usa IDs/páginas de Corpus para abrir el PDF y navegar por las coincidencias.
- La ingesta Civil Sprint 14.2 es INTERNAL y pasó extracción, búsqueda, página, matches y apertura de PDF.

## Operación DEV

Desde `JurisprudenciaN/back`, usar los alias protegidos o `node scripts/with-dev-db-guard.cjs <acción>`:

- `pnpm search:rebuild` / `pnpm search:projection:rebuild`: reconstruir proyección.
- `pnpm search:verify` / `pnpm search:projection:verify`: verificar conteos, consistencia y stale.
- `pnpm search:repair` / `pnpm search:projection:repair`: reparar diferencias confirmadas.
- `pnpm search:reindex`: reindexar con el flujo existente.
- Benchmarks y EXPLAIN: actions `sprint148-search-term-after`, `sprint148-search-phrase-after`, `sprint148-explain` y las acciones `sprint149-*` declaradas por el guard para la fase de diagnóstico.

El guard acepta únicamente `bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev`. No usar bases remotas o productivas.

## Estado medido después de Sprint 14.8

| Medida | Resultado |
|---|---:|
| Projection documents | 17.078 |
| Tokens | 18.799.500 |
| Stale | 0 |
| Mismatches | 0/100 documentos muestreados |
| Tamaño DB | 3.996.515.351 bytes |
| Índice de tokens | 395.116.544 bytes |
| TERM común | p50 203,50 ms; p95 278,78 ms |
| PHRASE | p50 1.710,58 ms; p95 2.621,10 ms |

Los benchmarks usaron 10 repeticiones por familia, endpoint HTTP 200, engine V2 y cero fallos de adapters. Las cadenas de consulta no se persistieron. Frente al corte previo de Sprint 14.2 (TERM 113/227 ms; PHRASE 270/538 ms), TERM subió moderadamente y PHRASE presenta regresión marcada.

Paridad entre adapters: 40/40 PASS en Sprint 14.8. Viewer smoke: 6/6 PASS para resultados, snippet, contenido/hash, selección de página y navegación repetida entre matches. La verificación final reportó `stale=0`, 0 discrepancias en 100 documentos y proyección lista.

EXPLAIN de cinco formas de consulta mostró que la búsqueda de frases tolerante a puntuación puede provocar lectura amplia de heap y muchas lecturas físicas; el plan candidato más costoso fue 52,8 s, diagnóstico de SQL candidato y no latencia medida del endpoint. La consulta corta `%de%` cayó en secuencial y leyó ~159.974 bloques; el token trigram mide 395.116.544 bytes. Esta evidencia motivó Sprint 14.9, cuyo diagnóstico y optimización medidos se registran abajo. No se declara Search listo para preproducción.

## Sprint 14.9 — perfilado y optimización PHRASE (2026-10-13)

**Resultado:** `PARTIAL / PHRASE REGRESSION REMAINS`. Se reprodujo la regresión con las mismas 15 familias, 10 repeticiones y 1 warmup del harness vigente, sobre 17.078 documentos y 18.799.500 tokens. El baseline de esta corrida dio PHRASE p50/p95 2.586,78/4.082,32 ms; 9/10 solicitudes completaron y una tuvo `57014` por `statement_timeout`. El endpoint siguió devolviendo HTTP 200, pero el adapter CORPUS falló en esa solicitud. Este baseline varía respecto del resumen Sprint 14.8 (1.710,58/2.621,10 ms), por lo que se conserva esa diferencia como variabilidad observada, no se mezclan las dos corridas.

| Familia | Before p50/p95 (ms) | After p50/p95 (ms) | Fallos after |
|---|---:|---:|---:|
| TERM común | 695,07 / 1.017,44 | 200,99 / 207,90 | 0 |
| PHRASE | 2.586,78 / 4.082,32 | 1.645,16 / 1.752,99 | 0 |
| PREFIX | 717,45 / 816,23 | 718,43 / 835,72 | 0 |
| SUFFIX | 2.119,17 / 2.221,82 | 2.267,27 / 2.363,39 | 0 |
| SHORT_TERM | 1.721,78 / 1.916,31 | 1.697,09 / 1.946,98 | 0 |
| FIELD | 1.647,55 / 1.661,16 | 1.634,19 / 1.677,08 | 0 |

PHRASE mejoró 36,4% en p50 y 57,1% en p95 respecto del baseline reproducido, y eliminó el timeout en el benchmark final. Sin embargo, p95 1.752,99 ms sigue en `REGRESSION REMAINS` frente al objetivo <=1.200 ms. El harness tuvo 10 repeticiones por familia y 1 warmup; las consultas no se escribieron en los informes. El reporte BEFORE no guardó promedio ni muestras individuales, así que su media exacta no es recuperable; el promedio PHRASE AFTER fue 1.639,25 ms. PostgreSQL fue 16.15 sobre Windows 11, Intel i7-13620H (16 procesadores lógicos, 16 GiB RAM), base `buscador_juridico_civil_dev` en `127.0.0.1:55432`.

### Ruta medida y causa raíz

La ruta seguida fue endpoint `/api/busqueda/avanzada` → parser/AST → `CorpusSearchSourceAdapter` → CTE de candidatos sobre `CorpusSearchToken` → `INTERSECT` → verificación literal contra `CorpusDocument.searchText` → límite/hidratación, snippet y página. Las frases frecuentes hicieron una consulta de readiness y una de página. La frase de baja cardinalidad devolvió 4 resultados exactos, pero activó tres ejecuciones de página adaptativas (queryCount 4 incluyendo readiness) mientras el adapter ampliaba el probe para certificar el total. No es N+1 por documento; es repetición del SQL de candidatos. No hay COUNT separado (`countMs=0`), pero `candidateStats` y la verificación se repiten dentro de cada página adaptativa. Parser, ranking y mapeo toman milisegundos; SQL e I/O dominan.

En el EXPLAIN ANALYZE de una frase frecuente, antes se leyeron 48.083 bloques compartidos y hubo 59.182 hits; la ejecución duró 558 ms en ese estado de caché. Los postings `%token%` del trigram devolvieron 12.606 y 34.415 filas para los dos componentes y el `SetOp` produjo 9.047 candidatos. En frases de tres palabras se observaron hasta 56.576 bloques leídos y 2.823 ms de ejecución. La frase positiva con 4 resultados tardó 4.431 ms desde el adapter; su último EXPLAIN ejecutó 2.688 ms con 9.702 hits y cero lecturas físicas. El costo restante incluye intentos adaptativos repetidos aunque la última lectura estuviera caliente. No hubo temp spill. Los cuellos confirmados son las lecturas amplias de heap de `CorpusSearchToken` y la repetición del SQL de candidatos al certificar totales de baja cardinalidad; ranking, snippet y lookup de página no explican la regresión.

### Cambios y EXPLAIN after

1. Los candidatos de frase de dos o más tokens anclan el sufijo del primer token y el prefijo del último cuando la gramática lo permite; tokens internos conservan búsqueda amplia. Cada candidato sigue verificándose contra el texto completo con el patrón de frase original, por lo que esto sólo reduce falsos candidatos y no reemplaza la frase por AND o similitud.
2. Se quitaron los `DISTINCT` redundantes de los CTE individuales: el `INTERSECT` posterior ya aplica semántica de conjunto. La elegibilidad/ACL de `CorpusDocument` se evalúa una vez luego de la intersección, no en cada posting.
3. La migración `20261013100000_sprint149_phrase_token_prefix_cover` agregó `lower(token) text_pattern_ops INCLUDE (documentId)`. El EXPLAIN after confirma su uso como `Bitmap Index Scan` para el prefijo final; trigram sigue atendiendo infijos/sufijos amplios. La operación sigue convirtiéndose en `Bitmap Heap Scan`, con lecturas físicas altas: el covering index aún no evita el heap.

En las repeticiones after, la frase frecuente tuvo EXPLAIN entre 424 y 903 ms con 42.057–42.059 bloques leídos; la frase de tres palabras, entre 1.750 y 3.483 ms con ~50.765 bloques leídos. No hubo temp spill. La frase positiva de cuatro resultados ejecutó su último plan en 2.688 ms, con 9.702 hits y cero lecturas físicas; el tiempo adapter total fue 4.431 ms por los reintentos adaptativos. La variación entre capturas muestra sensibilidad fuerte a I/O frío/caliente; el benchmark endpoint con warmup sigue siendo la medida de cierre. Los planes confirman el uso del índice covering junto con trigram, pero `Bitmap Heap Scan` sigue dominando. El índice nuevo mide 1.063.837.696 bytes; el trigram de tokens mide 395.116.544 bytes. El costo de almacenamiento es material y debe evaluarse contra su valor operativo antes de cualquier réplica productiva.

### Validación y decisión

- Search verify: PASS, 17.078 documentos, 18.799.500 tokens, stale 0, discrepancias 0/100.
- Paridad adapters: 40/40 PASS; viewer: 6/6 PASS, hash PDF verificado y navegación de coincidencias.
- Tests parser/adapter: 34/34; integración Corpus PostgreSQL: 3/3; pruebas PostgreSQL de búsqueda: 7/7; typecheck y build backend PASS; migraciones Prisma al día (21/21).
- Concurrencia PHRASE: una solicitud cold dio error de fuente CORPUS a ~4,07 s; 5 solicitudes concurrentes p95 1.295,70 ms sin errores; 10 solicitudes p95 1.993,28 ms sin errores, con 2 en espera del pool CORPUS (máximo 8 conexiones). Registrar cold failure como límite observado.
- La latencia después del warmup de la ola individual y la variación de I/O implican que una muestra de diez no demuestra comportamiento estable de cold start; no elevar timeouts ni declarar preproducción.

La evidencia extensa está en `_recovery-work/sprint149/` (`performance/`, `explain-before/`, `explain-after/`, `profiling-before.json`, `profiling-after.json`, `query-samples.json`, `query-templates-after.json`, `environment.json`, `environment-after.json`, `index-audit-after.json`, backups y `final-summary.json`). Se guardó el SQL real parametrizado como template y su forma/cantidad de parámetros; los valores de parámetros y texto consultado quedaron fuera del informe. Próxima hipótesis medible: materializar una vez el conjunto candidato para evitar reconstruirlo en cada ampliación adaptativa, manteniendo verificación literal y exactitud del total; además, medir si el índice covering puede lograr `Index Only Scan` en lugar de `Bitmap Heap Scan`. Separar cold/warm por consulta y mantener paridad antes de ampliar el cambio. No reabrir este gate hasta p95 <=1.200 ms con paridad intacta.

## Límites y mantenimiento

- No se hizo rediseño ni optimización preventiva. La proyección verificó sin rebuild necesario.
- La base es DEV local; estas cifras no certifican producción, concurrencia de red ni aceptación institucional.
- Después de cada importación grande, ejecutar `pnpm civil:verify-pilot`, `pnpm search:verify` y medir TERM/PHRASE. Investigar sólo regresiones reproducibles.
- Comandos de adquisición, fuentes y cobertura Civil se mantienen en `BJC-ADQUISICION-JURISPRUDENCIA.md`.

## Sprint 14.9.1 — materialización de candidatos y reutilización de ventanas (2026-10-13)

**Resultado: PARTIAL.** La materialización única elimina la reconstrucción de candidatos durante las ampliaciones y reduce el round-trip del caso con cuatro resultados exactos. La latencia PHRASE del benchmark de diez requests, sin embargo, empeoró frente a la reproducción inmediatamente anterior y sigue fuera del gate. No se declara el objetivo alcanzado.

| Medida | Baseline Sprint 14.9.1 | After |
|---|---:|---:|
| PHRASE, harness enfocado p50/p95 | 1.631,50 / 1.762,54 ms | 2.118,43 / 2.323,09 ms |
| PHRASE, harness completo de 15 familias p50/p95 | referencia anterior | 2.295,03 / 2.465,62 ms |
| Cold inicial (n=1) | no registrado por el harness anterior | 639,85 ms |
| Warm medido | 10 requests | 10 requests; warmup excluido |
| TERM común p50/p95, harness completo | 710,57 / 787,52 ms | 201,10 / 640,17 ms |

La corrida enfocada registra una regresión de 29,85% en p50 y 31,80% en p95 frente a su baseline comparable. El p95 está por encima de 1.200 ms. Las corridas PHRASE consecutivas después dieron p95 distintos (2.323 y 2.466 ms), así que se conserva la variabilidad observada.

### Trabajo adaptativo y cuello siguiente

El caso de cuatro resultados exactos conserva la misma huella y el mismo total: 331 candidatos, 4 resultados, 2 ampliaciones, ventanas [100, 200, 331] y coincidencias acumuladas [1, 1, 4]. Su tiempo de página/adaptador pasó de 4.431,47 ms a 2.094,06 ms. Los SQL por request bajaron de 4 a 2 (una readiness más una sola consulta de página); las ejecuciones de generación/intersección candidata bajaron de 3 a 1. La consulta común también genera candidatos una vez. Los IDs se mantienen dentro de PostgreSQL y la verificación literal ILIKE permanece.

En siete perfiles representativos, cardinalidad candidata p50=1.999, p95=8.958 y máximo=8.958. Los perfiles registran frases raras, sin resultados, de pocos resultados, acentuadas, dos palabras y tres palabras. El SQL after resuelve build/intersección, elegibilidad, verificación literal, conteo exacto cuando termina de escanear, ampliaciones y page/snippet en una ejecución. El desglose wall-clock de C–J no se mide por separado para evitar ejecutar otra vez el trabajo; stage-timings.json marca esas etapas como SQL combinado. El serializer de Corpus no expone timing por separado.

El siguiente costo identificado está dentro de esa misma consulta: phraseCandidateStats ordena y agrega los IDs de todo el set candidato antes de consumir la primera ventana. En EXPLAIN frecuente, ese agregado/orden tomó ~399 ms de los ~486 ms; el plan leyó 42.259 bloques compartidos, frente a 48.083 en el plan BEFORE comparable; los heap blocks exactos de CorpusSearchToken bajaron de 42.976 a 11.308. El perfil de tres palabras examinó 3.343 candidatos en cuatro ampliaciones, con 3.708 ms de SQL y un EXPLAIN inspector de 9.099 ms/56.193 bloques leídos. El plan no tuvo escrituras temporales. El trabajo pesado sigue siendo I/O de heap en CorpusSearchToken y ordenar/agregar el set completo.

### Índice y mantenimiento DEV

CorpusSearchToken_token_prefix_cover_idx mantiene tamaño 1.063.837.696 bytes. VACUUM (ANALYZE) sobre CorpusSearchToken elevó páginas all-visible de 89,01% a 99,985%, pero el plan continúa usando Bitmap Heap Scan para trigram e Index Scan ordinario para prefijo; no aparece Index Only Scan. Heap Fetches no aplica porque no hubo nodo Index Only Scan. No se añadió otro índice.

### Verificación y estado

- Search projection: PASS; 17.078 documentos, 18.799.500 tokens, stale=0, discrepancias=0/100.
- Paridad: 40/40 PASS, incluido BJC-054 en la repetición sin timeout. Viewer: 6/6 PASS.
- Parser/adapter: 34/34; PostgreSQL Search: 7/7; Corpus integración: 3/3; suite general: 93 PASS y 15 omitidos; schema verify 44 tablas/21 migraciones PASS; typecheck y build PASS.
- Benchmark PHRASE normal: 10/10 requests, sin error de fuente ni 57014. Concurrencia local de una request por usuario: 1 usuario tuvo un error de fuente CORPUS a 4.078 ms (HTTP 200); 5 usuarios p95=1.048 ms sin errores; 10 usuarios p95=1.399 ms sin errores y dos requests esperando el pool CORPUS.
- SQL parametrizado after, planes EXPLAIN y datos por run están en _recovery-work/sprint1491/. El SQL BEFORE exacto no se guardó en Sprint 14.9; se conserva la forma lógica y los planes BEFORE.

El sprint permanece **PARTIAL / PHRASE REGRESSION REMAINS**. No avanzar a la revisión de los 452 grupos hasta mejorar y volver a medir PHRASE con el gate p95 <=1.200 ms. Próxima prueba: evitar el orden/agregado de todos los IDs cuando basta una ventana inicial, conservando orden exacto, conteo y verificación literal; medir de nuevo heaps/buffers con los mismos casos antes de proponer índices.
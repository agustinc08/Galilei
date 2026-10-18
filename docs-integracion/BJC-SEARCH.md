# Search V2 — estado operativo

## Estado vigente Search — cierre de integración v3 (2026-10-18)

El contrato vigente es `COPERNIC_PREFIX_EXACT_PHRASE`: TERM simple = prefijo de unidad léxica; PHRASE = unidades completas, ordenadas y contiguas; sin stemming, sinonimia ni lematización. Se conservan comodines explícitos y la normalización de acentos/ñ ya certificada. OpenSearch 2.19.6/schema v3 implementa el contrato; PostgreSQL sigue como fuente de verdad. `galilei-search-active` apunta a `galilei-search-v003-20261017t232432555z-a6af18cb` (write alias). Cobertura exacta postpromoción: 69.313 IDs, hash `1e104fe4cb7eaa5604b42878d51a45884eb34048992eff43e946c8295c2af73f`, cero faltantes/extras/duplicados; Corpus 17.077, Sumarios 25.103, Sentencias 27.133, publicadas 6.014.

La arquitectura de frase usa postings de shingles posicionales con verificación exacta y ejecución windowed/top-N; no se cambia su diseño en este cierre. Certificación HTTP: Golden 325/325, phrase 100/100 (FP/FN/timeouts=0), prefix 14/14, adversarial 22/22, wildcards 3/3, boolean 7/7, filtros 16/16, combinaciones 5/5, sorts 8/8, ACL 7/7 con leaks de resultados/conteos 0/0, names 16/16 sin ILIKE, publicación/sync/Viewer/UTF-16/fail-closed PASS. Rendimiento crítico medido: responsabilidad civil p95 111,91 ms (total 4.759); falta de servicio p95 132,68 ms (total 1.826); phrase100 p95 1.032,26 ms. El endpoint público fail-closed responde 503 seguro si OpenSearch no está disponible y no invoca el legacy.

El verificador guarded postpromoción cerró su canal de transporte dos veces; la reconciliación directa paginada de los 69.313 IDs repitió exactamente el hash prepromoción. Se conserva esa limitación de transporte en `post-promotion-1_5_1.json`, sin ocultarla ni tratarla como fallo de datos. Clúster actual `green`; outbox 0/0. El índice ocupa 11,56 GiB y su rebuild medido demora ~72,9 minutos. C: dispone de ~42,4 GiB al cierre y admite un rebuild equivalente local; producción requiere reserva libre recomendada ≥50 GiB. El índice v1 de 42.180 documentos se retiene como rollback técnico; volver a v1 reduce cobertura y sólo corresponde ante incidente controlado. DEV no promovido; UAT institucional y preproducción siguen pendientes.

### Runbook local protegido (PowerShell, desde `JurisprudenciaN/back`)

Todos los comandos de base pasan por `scripts/with-dev-db-guard.cjs`; el guard sólo acepta `bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev`. No apuntar a producción ni servidores institucionales.

**Salud, alias, integridad y outbox:**
```powershell
pnpm opensearch:local:status
pnpm search:opensearch:status
pnpm search:opensearch:verify
Invoke-RestMethod 'http://127.0.0.1:9200/_alias/galilei-search-active' | ConvertTo-Json -Depth 8
Invoke-RestMethod 'http://127.0.0.1:9200/_cluster/health' | ConvertTo-Json
```

**Crear candidato sin mover el alias:** `opensearch-candidate` crea un índice versionado y ejecuta verificación exacta; inspeccionar `candidateReady`, integridad, hashes y conteos del resultado antes de cualquier corte. La acción no promueve el alias:
```powershell
node scripts/with-dev-db-guard.cjs opensearch-candidate
```
El rebuild normal construye, reconcilia el outbox bajo barrera, verifica exactitud y promueve el alias mediante una sola actualización atómica:
```powershell
pnpm search:opensearch:rebuild
```
Para un candidato ya verificado que requiera promoción manual, primero confirmar el índice físico y el alias actual. Sustituir `<INDICE_ANTERIOR>` y `<INDICE_CANDIDATO>` por esos nombres verificados y enviar **una única** operación `_aliases` con `remove` y `add` juntos; nunca ejecutar ambos cambios por separado:
```powershell
$body = @{ actions = @(
  @{ remove = @{ index = '<INDICE_ANTERIOR>'; alias = 'galilei-search-active' } },
  @{ add = @{ index = '<INDICE_CANDIDATO>'; alias = 'galilei-search-active'; is_write_index = $true } }
) } | ConvertTo-Json -Depth 8
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:9200/_aliases' -ContentType 'application/json' -Body $body
pnpm search:opensearch:verify
```

**Rollback operativo:** el índice v1 (42.180 documentos) se conserva para investigación, pero no se considera candidato compatible con el schema v3 actual ni se debe asociar manualmente al alias activo. Un candidato de rollback debe ser el único índice explícitamente seleccionado bajo `galilei-search` y llevar schema `v003`; el helper `selectCompatibleRollbackTarget` y el swap atómico rechazan namespace ajeno, versión incompatible y selección ambigua. El código sólo prepara/verifica estas acciones; no ejecuta un rollback real. Si no existe un candidato v003 verificado, reconstruir desde PostgreSQL y pasar el gate de integridad antes de promover.

**Outbox:** procesar una tanda, revisar contadores; reencolar fallidos sólo ante una recuperación explícita y volver a procesar/verificar:
```powershell
pnpm search:opensearch:sync-once
pnpm search:opensearch:retry-failed
pnpm search:opensearch:sync-once
pnpm search:opensearch:status
```

**Disco e índices físicos:**
```powershell
Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'" | Select-Object DeviceID,Size,FreeSpace
Invoke-RestMethod 'http://127.0.0.1:9200/_cat/indices/galilei-search-*?format=json&bytes=b&h=index,store.size,docs.count' | Format-Table
```
La limpieza es destructiva: lista/borrado automático conserva el índice activo, el índice anterior más nuevo y los índices con menos de 7 días; revisar primero inventario, referencias y rollback y ejecutar sólo cuando los índices elegibles estén aprobados:
```powershell
pnpm search:opensearch:cleanup
```

La promoción v3 en este corte fue atómica; el verificador guarded cerró el canal de transporte en dos intentos, compensado por barrido directo completo de IDs/hash. La certificación y operación no promueven DEV ni habilitan producción. Los apartados posteriores a esta nota son evidencia histórica de cortes anteriores.
> **Revalidación INT-1 (2026-10-14):** Search golden PASS; search verify PASS (17.078 documentos, 18.799.500 tokens, stale=0, discrepancias=0/100, rebuild=0). PHRASE responsabilidad civil total 10x: p50 956,57 ms, p95/máx 1.304,95 ms; Jurisprudencia 183/188/188 ms y Corpus 956/1.304/1.304 ms. Es un corte local, no SLO; p95 de Corpus sigue siendo prioridad antes de UAT.


> **Contexto INT-1 (2026-10-14):** Este contrato forma parte de Galilei integrado en la rama de integración. La interfaz presenta Jurisprudencia, Mi Sala / Juzgado y Mis documentos; Copernic queda como nombre interno. El estado global es PARTIAL y no habilita actualizar origin/dev: el snapshot local de publicación no coincide con el certificado y faltan los manifiestos J7/J8. Ver BJC-ESTADO-ACTUAL.md; los cortes y resultados históricos debajo conservan la fecha/sprint que los generó.


**Vigente:** Sprint 14.9.2 confirmó que el runtime PHRASE mantiene una ordenación y agregación completa de IDs candidatos antes de leer la primera ventana. No se retuvo un cambio de runtime; p95 comparable 2.427,38 ms y el total exacto continúa sin certificarse en early exit. Estado PARTIAL / PHRASE REGRESSION REMAINS.

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

## Sprint 14.9.2 — PHRASE windowed execution (2026-10-13)

**Resultado: PARTIAL / PHRASE REGRESSION REMAINS.** Se midió sobre DEV PostgreSQL 16.15 y el corpus de 17.078 documentos / 18.799.500 tokens, con las mismas 15 familias, 10 muestras y 1 warmup antes y después. El runtime quedó restaurado al mismo código; no se conservó la implementación experimental.

| Familia | Before p50/p95 (ms) | After p50/p95 (ms) |
|---|---:|---:|
| TERM común | 200,81 / 279,33 | 202,32 / 265,87 |
| PHRASE | 2.225,24 / 2.394,03 | 2.272,01 / 2.427,38 |
| PREFIX | 815,32 / 949,19 | 816,84 / 943,60 |
| SUFFIX | 1.689,22 / 1.734,50 | 1.712,13 / 1.772,89 |
| SHORT_TERM | 2.006,16 / 2.098,82 | 1.961,57 / 2.046,51 |
| FIELD | 1.686,78 / 1.723,40 | 1.703,65 / 1.773,85 |

PHRASE empeoró 2,10% en p50 y 1,39% en p95. El EXPLAIN de la frase frecuente de dos palabras encontró 8.958 candidatos: phraseCandidateStats ordena y agrega todo ese conjunto con array_agg ordenado, cuyo Sort atendió 8.958 filas en 401,526 ms (agregado inclusivo 402,253 ms). El top-N final procesó 11 filas en 0,395 ms. El plan leyó 42.259 bloques compartidos, tuvo 52.893 hits y cero bloques temporales. En la frase de tres palabras, 3.343 candidatos produjeron cuatro expansiones; el plan diagnosticado tardó 8.726 ms y leyó 56.185 bloques. Los tiempos de nodos son inclusivos y no se suman.

La ventana adaptable sigue comenzando en 100 y duplica hasta cubrir 331 candidatos en el caso pequeño: ventanas [100, 200, 331], resultados por ventana [1, 1, 4], 2 expansiones y totalExact=true. En la frecuente de 8.958 candidatos, la ejecución retorna temprano con 72 coincidencias exactas vistas y 11 filas de página; totalExact=false. Esto preserva la verificación literal y el orden de página (fecha DESC NULLS LAST, updatedAt DESC, id ASC), pero no satisface el contrato de total exacto para ese early exit.

Se probaron dos alternativas y se descartaron. Materializar y verificar cada texto para contar exactamente tardó 29.515 ms (5.372 coincidencias; 65.049 lecturas, 100.072 hits). Usar directamente el GIN de searchText tardó 32.008 ms: 10.357 entradas de índice y heap scan de 31.905 ms para la misma cuenta exacta de 5.372. El top-N en ambos fue ~2,6–2,7 ms; el cuello está en verificar el texto largo para count, no en el top-N. No se modificó el adapter de producción ni el schema.

Paridad 40/40, viewer 6/6, Search verify PASS (17.078 documentos, 18.799.500 tokens, stale 0, muestra mismatch 0/100), parser/adapter 34/34, PostgreSQL Search 7/7, Corpus 3/3, suite backend 93 PASS / 15 omitidos, typecheck y build PASS, schema 44 tablas / 21 migraciones. Concurrencia local de una solicitud por usuario: 1 usuario p95 871,92 ms; 5 p95 1.013,83 ms; 10 p95 2.057,80 ms; errores HTTP/fuente 0 en las tres olas. No implica carga tras proxy/TLS.

La evidencia reproducible está en _recovery-work/sprint1492/: baseline.json, query-shape.json, operator-costs.json, candidate-cardinality.json, window-analysis.json, query-counts.json, benchmark-before.json, benchmark-after.json, run-samples.json, explain-before/ y explain-after/. SQL parametrizado conserva placeholders; los valores de búsqueda no se guardaron. Próxima hipótesis: un índice/proyección de verificación de frase que conserve puntuación y acentos, habilitando conteo exacto sin escanear repetidamente el heap de texto.

## Alcance privado por workspace — Sprint 15

Corpus Search sigue usando Search AST y `CorpusSearchSourceAdapter`. Por defecto, toda consulta Corpus usa `documentScope=GENERAL`. La llamada privada se crea sólo tras validar membership activa; scope/workspaceId se parametrizan en SQL y `EXISTS WorkspaceDocument` restringe la elegibilidad antes de COUNT, página, snippet e hidratación. `RESTRICTED` se incluye sólo en el contexto privado autorizado y requiere simultáneamente `PRIVATE_WORKSPACE` y el workspace exacto; el scope general no devuelve documentos privados ni a ADMIN global. Los endpoints de metadata, matches y file repiten esa restricción. No hay sugerencias/autocomplete de privados fuera de esta API scoped. Sprint 14.9.2 PHRASE queda PARTIAL, sin cambios de optimización en Sprint 15.

### Sprint 15.1.1 — medición de TERM privado con ACL (2026-10-13)

El baseline Sprint 15.1 a 500 documentos tenía ACL count delta p50/p95 de 59,34/66,64 ms y un nested loop con 174.750 filas descartadas. El origen fue una estimación stale de `CorpusDocument` (1 estimada frente a 600 reales) que llevó a repetir el lookup de `WorkspaceDocument` por candidato. Tras actualizar estadísticas, el plan elige Hash Join y procesa el set de workspace una vez. `EXISTS`, JOIN directo, IN y CTE autorizado llegan a formas hash equivalentes con estadísticas frescas; se conserva el `EXISTS` parametrizado actual y no se agregan índices.

La migración DEV `20261013150000_sprint1511_private_search_stats_maintenance` baja los umbrales por tabla y analiza inicialmente `CorpusDocument`/`WorkspaceDocument`. El join ACL aislado después fue p50/p95 −0,03/0,76 ms para 500, 1,51/7,39 ms para 1.000 y 0,56/14,57 ms para 5.000 (el valor negativo pequeño a 500 es ruido de medición). Los límites de ingeniería del workspace se cumplen para comunes a 100 y 500; a 1.000 el común queda 365,9/417,0 ms, y a 5.000 181,1/838,9 ms, con variación max/p50 4,74×. Cero resultados cuesta 500–590 ms por el conteo exacto. Estado: PARTIAL; el cuello restante está en el set `CorpusSearchToken`/página, no en el join ACL.

En el EXPLAIN de candidatos de 5.000, el índice `CorpusSearchToken_token_trgm_idx` produce 113.800 entradas, luego `Unique`/`Gather Merge` reduce a 5.000 IDs y un nested loop hace 10.000 búsquedas PK de `CorpusDocument`; la ACL misma usa un Hash Join, sin filas descartadas. El adapter mide hasta 747 ms de página y request p95 839 ms en una serie. La consulta simplificada de candidatos dio 110 ms y candidate-page 142 ms; seguir midiendo el statement completo de página/hidratación y reducir el sobregenerado trigram/deduplicación. No tocar PHRASE ni extender los workspaces hasta cerrar esta variación.

Search general verify sigue PASS: 17.078 documentos, 18.799.500 tokens, stale 0, mismatch 0/100; paridad 40/40 y viewer 6/6. TERM común general dio p50/p95 216/322 ms en 10 warm requests frente al benchmark Sprint 14.9.2 de 201/279 ms (+7,7%/+15,3%); PHRASE de control 1.711/2.621 ms y su deuda de total exacto continúa. Detalle ACL/seguridad y artefactos en `BJC-ESPACIOS-DOCUMENTALES.md` y `_recovery-work/sprint1511/` (ignorado por Git).
## UX de Search privado — Sprint 15.3 (2026-10-13)

Classic Search presenta el valor de totalExact sin convertir una ventana parcial de PHRASE en un conteo exacto. El filtro privado por sourceId/sourceFolder se aplica dentro del scope autorizado por workspace y alcanza tanto contenido como nombre. Search-as-you-type no está activado; la UI ejecuta al enviar el formulario y cancela requests anteriores al cambiar query o alcance.

El fixture browser midió un request TERM de 155 ms, primer resultado en 12 ms, primer render del PDF en 954 ms, cambio de página en 61 ms y F3 en 10 ms. Es evidencia de una ejecución local sintética, no benchmark del motor ni SLO. El parser, ranking, conteo de PHRASE y proyección no se modificaron en Sprint 15.3. La garantía de spans de frase y su resaltado exacto permanece pendiente.

## Sprint 15.3.1 — filtros y contrato de spans (2026-10-14)

**Estado técnico: PARTIAL.** Los filtros privados de fecha/tipo ahora llegan a SQL y se aplican antes de conteo/página. Source y folder permanecen query-level dentro del workspace autorizado. `/matches` devuelve spans en el texto original extraído por página; el viewer intenta mapearlos al text layer de PDF.js mediante texto normalizado, contexto y ordinal. Si la correspondencia no es determinista no dibuja un highlight aproximado. El fixture PDF sintético validó el span exacto; no se certificó la alineación entre extractores para todos los PDF reales, por lo que el cierre visual universal sigue pendiente.

### Filtros

- `dateFrom` y `dateTo` son cadenas calendario `AAAA-MM-DD`, validadas en backend; el rango es inclusivo. Workspace Search usa `CorpusDocument.decisionDate` (`TIMESTAMP(3)` sin zona horaria); SQL compara desde `dateFrom` inclusive hasta antes de `dateTo + 1 día`. No usa `createdAt` como fallback. `decisionDate IS NULL` queda fuera si hay un rango activo.
- `type=PDF|TXT` compara el MIME de la última versión de `CorpusDocumentFile`, normalizado en SQL (`application/pdf` y `text/plain`). MIME faltante/no reconocido no satisface un filtro de tipo. El upload privado manual admite PDF y TXT; el scanner de fuentes conserva su alcance PDF.
- `workspaceId`, membership activa, `PRIVATE_WORKSPACE`, vínculo `WorkspaceDocument`, source/sourceFolder, folder Galilei, tipo, fecha y query se combinan con AND. Source/folder/type/date se aplican antes de count y paginación en Search por contenido y nombre. Los conteos corresponden al subconjunto autorizado y filtrado.
- No se agregó migración ni se modificó el scope GENERAL. Search general continúa requiriendo `documentScope=GENERAL`; no puede descubrir documentos privados.

### Contrato `/matches`

Cada resultado devuelve `page`, `start`, `end`, `offset` (alias legado de `start`), `text`, `term`, `kind` (`TERM|PHRASE`), ordinal global, `pageOccurrenceOrdinal`, `context`, `contextBefore` y `contextAfter`. `start` es inclusivo y `end` exclusivo, ambos en unidades UTF-16 del texto original extraído para esa página. Los acentos de vocales y mayúsculas no alteran los offsets; `ñ` permanece distinta de `n`.

TERM conserva substring/prefix/suffix según el AST. PHRASE requiere palabras adyacentes tras la normalización ya usada por Search: runs de espacios/tabs/saltos de línea se comparan como un espacio, pero el span apunta al rango completo original (incluido el salto). La puntuación de la página no se elimina; “daño, moral” no es el span de la frase “daño moral”. Las pruebas también rechazan palabras separadas por texto ajeno y no generan spans para NOT ni para campos metadata.

`returned` cuenta los spans visibles; `truncated` se activa sobre el límite 500; `exactTotalKnown=false` y `total` representa la muestra devuelta cuando se alcanza ese límite. La navegación sólo recorre los spans devueltos y comunica que existe truncation. No se implementó NEAR ni OCR.

El viewer convierte los límites normalizados del span a texto PDF.js conservando offsets de origen. Contexto y ordinal desambiguan repeticiones; si no se resuelve un mapeo único, el resultado queda sin marca visual en vez de resaltar otra ocurrencia. Para TXT, metadata, texto por página y matches usan el mismo texto extraído.

### Rendimiento y verificación

Benchmark endpoint Search V2, una warmup + 10 medidas; la consulta no se persiste:

| Familia | Before p50/p95 ms | After p50/p95 ms |
|---|---:|---:|
| TERM común | 325,18 / 390,95 | 330,16 / 350,40 |
| Cero resultados | 11,80 / 12,11 | 29,86 / 31,10 |
| PHRASE de 2 palabras | 919,20 / 1.235,86 | 928,37 / 961,17 |

TERM común y PHRASE no muestran regresión material en p95; cero resultados sube ~19 ms en términos absolutos. Los benchmarks no incluyeron PHRASE de 3 palabras, por lo que su before/after queda N/A.

Filtro privado en fixture sintético de 2 documentos: source 17,76/18,90 ms; folder 17,13/20,34 ms; type 18,84/24,59 ms; date 17,12/18,09 ms; combinado 20,87/22,62 ms (p50/p95, 1 warmup + 10 medidas). Search verify sigue PASS: 17.078 documentos, 18.799.500 tokens, stale 0, mismatch 0/100. Viewer general: 6/6. Los artefactos locales ignorados están en `_recovery-work/sprint1531/`.

## Sprint 15.3.2 — mapping visual de Search a PDF.js (2026-10-14)

**Certificación: PARTIAL / PARTIALLY CERTIFIED.** El contrato Search no cambió: `/matches` conserva `page`, `start` inclusivo, `end` exclusivo, texto y contexto; los offsets siguen siendo UTF-16 sobre el texto original extraído por página. El Viewer construye un mapa aparte desde los items de texto de PDF.js, mantiene los offsets locales de cada item y produce segmentos visuales sólo cuando una ocurrencia única queda anclada por texto/contexto/ordinal. La normalización de vocales, espacios y saltos conserva el origen de cada carácter; `ñ` sigue siendo distinta de `n`. Separadores inferidos por geometría sólo se insertan entre items de la misma línea cuando hay hueco visible.

Estados del mapper: `DIRECT_EXACT`, `CONTEXT_EXACT` y `NORMALIZED_EXACT` generan segmentos; `AMBIGUOUS`, `UNMAPPABLE` y `NO_TEXT_LAYER` generan cero segmentos. En estos últimos casos el Viewer conserva la página de Search y muestra el snippet/contexto con un aviso accesible; no elige una coincidencia aproximada. El mapping es visual independiente del span exacto de Search y no altera filtros, parser, ranking, ACL ni base de datos.

### Muestra local y resultado

Se auditaron 25 PDFs locales de DEV, 827 páginas, años 2008–2026, de Cámara Nacional de Apelaciones en lo Civil (22), Juzgado Civil 64 — Secretaría 94 (1) y 2 sin tribunal informado. Los productores detectados incluyen OpenOffice, LibreOffice, Nitro, OpenHTMLToPDF/iText, ABBYY FineReader y Ghostscript. Checksums SHA-256: 25/25 válidos. No se copiaron ni versionaron PDFs.

| Comparación de página | Cantidad |
|---|---:|
| Extractor y PDF.js exactos | 155 |
| Diferentes sólo por espacios/saltos de línea | 672 |
| Sin text layer | 0 |

El mapper procesó 221 spans: 35 `DIRECT_EXACT`, 103 `CONTEXT_EXACT`, 0 `NORMALIZED_EXACT`, 0 `AMBIGUOUS`, 83 `UNMAPPABLE` y 0 `NO_TEXT_LAYER`. Revisó los glifos de los 138 segmentos mapeados: **0 mapeos falsos**. TERM real: 4/25 spans mapeados; 21/25 sin anclaje seguro. PHRASE de dos/tres palabras: Search produjo 18 spans, 3 mapeados y 15 `UNMAPPABLE`; otros 7 intentos no devolvieron span. Repeticiones: 71/75 mapeadas con ordinal/contexto. Acentos: 5/25 mapeadas; `ñ`: 25/25. Se resolvieron 2 casos reales multi-item y 2 spans con salto de línea. Estos resultados mantienen el sprint PARTIAL para términos/frases habituales.

Las diferencias del texto de página fueron únicamente `WHITESPACE_OR_LINE_BREAK` (672); no se observaron páginas sin texto. La muestra no aporta evidencia suficiente para certificar ligaduras, palabras con guion editorial, orden de columnas u OCR como clases generales. La tasa de mapping no convierte equivalencia de texto en prueba de posición: cualquier discrepancia sin anclaje sigue cerrando sin highlight.

### Rendimiento, UI y regresión

`buildPdfTextPageMap` por página: p50 1,744 ms / p95 4,921 ms (827 páginas). Mapping por span: p50 0,116 ms / p95 0,441 ms, máximo 0,956 ms (221 spans). La transición F3 de 10 ms pertenece al E2E previo Sprint 15.3.1; no se volvió a medir en esta ronda.

Se corrigió una condición de carrera: el text layer puede llegar antes que la respuesta Search. El Viewer ahora guarda el mapa de página y deriva de nuevo los mappings al recibir los matches, evitando quedarse con el estado vacío inicial. El E2E acepta únicamente highlight activo visible o fallback explícito sin highlight activo. Playwright pasó 5/5; el smoke autenticado de Viewer general pasó 6/6. La captura visual comprobó canvas no vacío, texto PDF.js y highlight activo superpuesto sobre el texto; se revisaron estados de viewport 1366×768, escala de viewport equivalente a 125%/80% y resize a 900×768. Artefactos locales ignorados: `_recovery-work/sprint1532/`.

Search verify: 17.078 documentos, 18.799.500 tokens, stale 0 y 0 discrepancias/100; no guardó texto de consulta. Prisma migrate status: 24 migraciones al día. Frontend typecheck, lint dirigido y build: PASS. ACL workspace/general no cambió; su evidencia automatizada sigue siendo la de Sprint 15.3.1 y no se repitió aquí. No hubo cambios backend, de schema o migraciones.

## Sprint 15.3.3 — endurecimiento de cobertura del mapping PDF.js (2026-10-14)

**Certificación acotada: PASS en los spans muestreados; cobertura universal sigue pendiente.** Search conserva el contrato de `/matches` (`page`, offsets UTF-16 `[start,end)`, texto y contexto). Sólo cambió la capa visual del Viewer: al recibir el texto extraído de la página solicitada, alinea el texto completo contra PDF.js por la secuencia ordenada de glifos no blancos. Acentos de vocales se normalizan para la comparación; `ñ`, puntuación y orden se preservan. Runs de whitespace sólo se equiparan; un límite de item sólo aporta separador con `hasEOL` o evidencia geométrica positiva en la misma línea. El contexto exacto busca anclas progresivas de 16/32/64 unidades; ordinal sólo desempata si el número de ocurrencias coincide. Si falta evidencia única, el Viewer no dibuja el segmento.

La reproducción de Sprint 15.3.2 dio los mismos 221 estados iniciales en 25 PDFs/827 páginas: 35 `DIRECT_EXACT`, 103 `CONTEXT_EXACT`, 83 `UNMAPPABLE`, cero ambigüedades y cero falsos mappings. Los 83 casos se clasificaron en 76 `LINE_BREAK_VS_SPACE` y 7 `TEXT_ITEM_BOUNDARY_NO_SPACE`. Tras el cambio se ubicaron los 221 spans: 35 `DIRECT_EXACT`, 178 `NORMALIZED_EXACT`, 7 `SEGMENTED_EXACT` y 1 `CONTEXT_EXACT`; auditoría de la secuencia visible: 0/221 falsos. TERM quedó 25/25; PHRASE 18/18; repetidos 75/75; acentos 25/25; `ñ` 25/25. Esto certifica los casos observados, no documentos arbitrarios, ligaduras, OCR ni orden de columnas.

La muestra ampliada incluyó 45 PDFs/968 páginas y 11 productores; los 45 checksums SHA-256 coincidieron. En los 20 PDFs añadidos (141 páginas), PDF.js fue idéntico al extractor en 57 páginas, equivalente salvo whitespace en 83 y sin capa de texto en 1; no hubo diferencias de glifos en las páginas con text layer. Esa página sin capa también tenía extracción de origen vacía, por lo que no existía span que representar. En las 827 páginas base, el alineador estricto actual deja 6 páginas como `NON_WHITESPACE_DIFFERENCE`; sólo una contiene un span muestreado, y ese span quedó anclado por contexto exacto y pasó la auditoría de glifos. El resto de las páginas discrepantes permanece fuera de esta certificación.

Diez casos reales que antes eran `UNMAPPABLE` se probaron en el Viewer autenticado: canvas no vacío, texto del mark igual al span de API, marca activa naranja y resize a 1093×614 y 900×768; 10/10 PASS. También pasó PDF-first/Search-later y la carrera Query A retrasada después de Query B. E2E de workspace pasó con Search/preview/filtros/F3/Shift+F3; PostgreSQL workspace ACL pasó. Search general devolvió 21 total/20 en página y cero privados, con `totalExact=false` informado por la ventana parcial. El Search projection verify no reconstruyó datos: 17.078 docs, 18.799.500 tokens, stale 0, discrepancias 0/100. Prisma status confirmó 24 migraciones aplicadas; Viewer general 6/6.

## Sprint 15.4A — tipos multiformato en Search

El filtro privado `type` reconoce PDF/TXT/RTF/DOC/DOCX/ODT a partir del MIME canónico de la versión vigente. Search indexa texto nativo extraído de TXT/RTF/DOCX/ODT y, para `OCR_REQUIRED`, conserva indexable el texto nativo de páginas disponibles. `.doc` no produce texto y no entra a resultados de contenido. Se mantuvieron iguales scope, SQL de workspace, membresía y conteo. No se reconstruyó la proyección general: 17.078 documentos, 18.799.500 tokens, stale=0, mismatch=0/100 después de las suites.

El preview textual de RTF/DOCX/ODT resalta únicamente la coincidencia literal del texto extraído; la certificación PDF.js de Sprint 15.3.3 no se extiende automáticamente a otros formatos ni a texto OCR. OCR todavía no está disponible. Detalle de estado/provenance en `BJC-PROCESAMIENTO-DOCUMENTAL.md`.

En el microbenchmark local de una pasada, preparación de página p50/p95: 2,785/8,144 ms, incluida alineación p50/p95 0,556/0,888 ms; mapping por span p50/p95 0,052/0,109 ms (máximo 5,475 ms observado). El tiempo p95 de preparación fue mayor que la referencia medida en la pasada base (5,832 ms); no se presenta como ausencia de costo y las cifras no son SLO. Build/typecheck/lint dirigido y 17 grupos de pruebas unitarias del mapper pasaron. Evidencia local ignorada y sin PDFs: `_recovery-work/sprint1533/` (`baseline.json`, `before-after.json`, `expanded-sample.json`, `real-mapping-results.json`, `false-positive-audit.json`, `unmappable-analysis.json`, `visual-checks.json`, `performance.json`, `final-summary.json` y capturas).
## Texto OCR y navegación — Sprint 15.4A.1 (2026-10-14)

Las páginas conservan `textKind=NATIVE` u `OCR` y provenance del archivo SHA, motor, versión, idioma, DPI, página y advertencias. Cuando termina el OCR, se reindexa únicamente el documento afectado; no se ejecuta un rebuild global. En PDF híbrido, el texto nativo y OCR se combinan en orden de página y sólo se procesan páginas candidatas.

Search aplica el scope/ACL existente también a texto OCR privado. Una coincidencia OCR admite snippet/contexto, página y navegación F3/Shift+F3. No se declara geometría de texto OCR ni se dibuja highlight sobre PDF.js mientras esa correspondencia no esté certificada. El estado de procesamiento se expone con copy de usuario, no como código técnico `OCR_PENDING`.
## Sprint 15.5 — certificación Search + Viewer

Estado técnico: **CERTIFIED_WITH_KNOWN_LIMITATIONS para beta controlada en DEV**. La suite versionada ejecuta 319 casos PostgreSQL (300 queries sintéticas generadas + 19 contratos), todos PASS. La muestra local real contiene 300 documentos, 4 fuentes, 10 buckets de año y 299 PDF/1 TXT; sus IDs quedan sólo en evidencia ignorada.

Se verificaron 325 resultados paginados sin duplicados ni faltantes; el total es límite inferior mientras haya más páginas y exacto en la última o fuera de rango. La página fuera de rango ahora ejecuta COUNT exacto. Spans PREFIX/SUFFIX cubren el token completo, con límites UTF-16. Workspace A/B, conteos, snippets, Viewer y descargas respetan ACL. La gramática y mediciones, incluidos límites y latencias, están en `BJC-CERTIFICACION-SEARCH-VIEWER.md`.

OCR ofrece texto, contexto, página y F3/Shift+F3; su highlight visual sigue sin certificación y se omite. UAT institucional, matriz exhaustiva XSS/SQLi y SLO de producción siguen pendientes.

## SEARCH-CONTRACT-CHANGE-1 — semántica lexical validada (2026-10-16)

La decisión humana resolvió la incertidumbre documentada en la auditoría previa: la coincidencia parcial automática de TERM/PHRASE era accidental (SUBSTRING_ACCIDENTAL, confianza alta).

- TERM simple: unidad léxica completa; sin stemming ni lematización.
- PHRASE: secuencia ordenada y contigua de unidades léxicas completas.
- Prefijo/sufijo/contiene parcial: sólo mediante los comodines explícitos que ya acepta el parser (term%, %term, %term%).
- Acentos vocálicos tolerantes; ñ distinta de n; números, espacios, saltos, puntuación, campos, filtros, booleana, ACL y total exacto mantienen la normalización/contratos vigentes.

**Estado:** documentado y evaluado en prototipo aislado; aún no integrado en el adapter. El modelo CorpusSearchToken verificado en DEV contiene 18.799.500 filas y no almacena posiciones; se evaluó PostgreSQL FTS simple (sin stemming), con marcadores de separador para retener la semántica actual de -, ., /. Los fixtures controlados pasaron 16/16, incluidos coma normalizada, guion preservado, salto de línea, acentos y ñ. El benchmark del índice sobre el corpus real, la paridad de 100 consultas y el gate de ACL/producto siguen pendientes. Antes de cualquier índice/migración estructural en DEV se requiere backup nuevo verificado; la migración candidata sería aditiva #29 y no modifica las 28 anteriores.

## Actualización — prototipo lexical posterior a SEARCH-CONTRACT-CHANGE-1 (2026-10-16)

La auditoría semántica quedó resuelta por decisión humana (`SUBSTRING_ACCIDENTAL`, confianza alta): TERM simple y PHRASE requieren unidades léxicas completas; no hay stemming; los comodines explícitos conservan el comportamiento documentado. El reporte de uso local de DEV cubrió 620 eventos (234 con query) entre 2026-10-08 y 2026-10-15: 0 consultas con `%`, 12 con comillas y 12 con booleanos. No se exportaron consultas ni usuarios; esta muestra de desarrollo no representa uso institucional.

El FTS posicional simple logró p95 combinado 999 ms para “responsabilidad civil”, pero omitió 1 resultado (5.363 vs 5.364) y 45 de “falta de servicio” (149 vs 194), por truncamiento posicional, y se rechazó. El FTS híbrido por ventanas alcanzó los dos totales esperados y 23/23 fixtures, pero p95 combinado fue 2.467 ms para “responsabilidad civil” y 437 ms para “falta de servicio”; el primero incumple el máximo 2 s. Consultas amplias “civil” y “ley” también superaron 2 s. La prueba no completó paridad exacta de IDs en el corpus ni el set de 100 frases. Son prototipos aislados con objetos temporales revertidos; no hay cambio de adapter, migración, índice persistente ni integración. Recomendación: `SEARCH-ENGINE-EVAL-2` con la semántica lexical, si continúa la selección de motor. Evidencia: `_recovery-work/search-semantics-audit1/performance-current-vs-lexical.json` y `_recovery-work/search-contract-change1/`.

## Reapertura de semántica histórica — SEARCH-SEMANTICS-AUDIT-2 (2026-10-16)

La clasificación previa SUBSTRING_ACCIDENTAL / confianza alta se conserva como antecedente, pero deja de ser una conclusión vigente. Una segunda fuente humana anónima contradice a la primera: H1 recuerda que Copernic no encontraba CIVIL dentro de CIVILIZACIÓN y recuerda TERM/PHRASE léxicos; H2 recuerda que sí encontraba CIVIL dentro de CIVILIZACIÓN y resaltaba sólo CIVIL. H2 no recuerda todavía el comportamiento de la frase entre comillas. Las dos son memorias humanas, no capturas ni pruebas de runtime.

El estado histórico vuelve a SUBSTRING_UNCERTAIN por CONFLICTING HUMAN LEGACY RECOLLECTION. TERM y PHRASE se evalúan por separado; PREFIX, SUFFIX y CONTAINS también quedan sin clasificación hasta prueba específica. La Golden 319/319 no resuelve esta intención: cero casos requieren coincidencia parcial dentro de una palabra.

El código actual de Galilei es evidencia de implementación, no autoridad sobre Copernic; además Corpus y Jurisprudencia no tienen predicados idénticos. No se modificaron parser, matcher, SQL Search, Golden, API, frontend, esquema ni índices. La decisión de motor queda DEFERRED y SEARCH-ENGINE-EVAL-2 no se ejecuta hasta cerrar esta auditoría. Evidencia y pack neutral: _recovery-work/search-semantics-audit2/.

## SEARCH-SEMANTICS-AUDIT-2 — actualización final (2026-10-16)

**Contrato objetivo cerrado: COPERNIC_PREFIX_EXACT_PHRASE.** TERM simple busca palabras que empiezan con el término: civil encuentra civilización y no incivil cuando civil aparece sólo dentro de la palabra. PHRASE entre comillas requiere palabras completas, orden y contigüidad: "responsabilidad civil" encuentra esa frase y no superresponsabilidad civilizado. No se agrega stemming, lematización ni sinónimos. Se preservan las reglas ya certificadas de acentos vocálicos, ñ distinta de n, números, puntuación y espacios/líneas.

La documentación oficial respalda prefix y búsqueda exacta de palabra/frase entre comillas; la guía CDS 8 marca suffix search como no disponible en esa guía. Los comodines son una función separada/versionada y no prueban equivalencia con term%, %term o %term% de Galilei. Fuentes: [Copernic Prefix Search](https://copernicsearch.freshdesk.com/en/support/solutions/articles/47001129478-prefix-search-how-it-works); [CDS 8 Quick Start Guide](https://copernic.com/wp-content/uploads/2024/01/CDS8_quick_start_guide.pdf); [Copernic Search Operators](https://copernicsearch.freshdesk.com/en/support/solutions/articles/47001112953-refine-search-with-search-operators); [Copernic Release History](https://copernic.com/en/desktop/release/). Procedencia y alcance: _recovery-work/search-semantics-audit2/external-copernic-evidence.json.

H2 reportó además que "responsabilidad civil" aparece con ambas palabras resaltadas y no aparece superresponsabilidad civilizado. El resaltado parcial CIVIL en CIVILIZACIÓN también es informe humano de apoyo. No se recibió captura ni se ejecutó localmente el runtime histórico; no se afirma prueba directa de esa instalación. El recuerdo de H2 sobre posible infix de RESPONSABILIDAD se conserva como recuerdo conflictivo de baja confianza; no se adopta y no se afirma que H2 se haya equivocado.

**Diferencia actual:** plain TERM de Galilei puede usar substring sin límites léxicos. Corpus PHRASE permite secuencia literal sin límites léxicos; el adapter moderno de Jurisprudencia aplica límites por espacios. Código y Golden no se modificaron. Golden actual: 319 casos, 0 explícitamente dependientes de coincidencia partial-word. Seis casos futuros prefix/infix y frase exacta/parcial quedan planificados.

term%, %term y %term% quedan como extensiones avanzadas Galilei. term% se solapa con TERM prefix y la decisión de alias queda abierta; suffix y contains quedan para revisión. Motor DEFERRED; no se ejecutó benchmark. EVAL-2 previo bajo substring no compara este contrato. Próximo sprint: SEARCH-CONTRACT-COPERNIC-1, implementar y medir PostgreSQL primero; evaluar otro motor sólo si PostgreSQL no cumple. INT-1S bloqueado por implementación/rendimiento; INT-1R espera Search; DEV no promovido; UX-2 no iniciado.


## SEARCH-CONTRACT-COPERNIC-1 — PostgreSQL rechazado (2026-10-16)

El contrato de producto queda cerrado como `COPERNIC_PREFIX_EXACT_PHRASE`: TERM simple = prefijo léxico; palabra entre comillas = palabra exacta; frase entre comillas = secuencia literal normalizada exacta con límites léxicos externos. Se conservan acentos vocálicos tolerantes, ñ distinta de n, normalización vigente de números/puntuación/espacios y los comodines explícitos Galilei `term%`, `%term`, `%term%`.

**PostgreSQL: REJECTED para este contrato en el estado/prototipos evaluados.** En DEV local (PostgreSQL 16.15, 17.077 documentos elegibles), el candidato A (trigram document-wide + verificación regex) agotó el límite de 2,1 s en 2.114 ms para “responsabilidad civil”; el candidato B (proyección token existente + verificación del texto completo) agotó el mismo límite en 2.112 ms. El gate máximo es p95 combinado <2 s. Ambos fueron rechazados antes de paridad completa; sus IDs candidatos quedan sin certificar. El FTS posicional previo omitió 1 ID en “responsabilidad civil” y 45 en “falta de servicio”; la variante híbrida alcanzó los conteos pero registró p95 de 2.467 ms para la frase crítica.

El candidato C por páginas quedó NOT_RUN: la tabla tiene 198.129 páginas, pero sólo 16.683/17.077 documentos elegibles tienen páginas no vacías en su última extracción; no existe índice posicional/FTS de páginas. La migración local previa eliminó el índice trigram de páginas porque los términos comunes visitaban unas 20.000 tuplas y eran más lentos que el GIN documental. Construir una nueva proyección sin demostrar literalidad, cobertura, coste de build e impacto incremental no justifica entrar a implementación. No se modificaron adapter, parser, Golden (319 casos), schema ni migraciones; no hubo escrituras persistentes a DEV.

Siguiente paso: `SEARCH-ENGINE-EVAL-2` bajo el contrato prefix + frase exacta. La evaluación histórica OpenSearch bajo substring no decide su aptitud para este contrato. INT-1S queda BLOCKED BY ENGINE; INT-1R BLOCKED; DEV no promovido; rama UX intacta. Evidencia local ignorada: `_recovery-work/search-contract-copernic1/`.

## SEARCH-ENGINE-EVAL-2 — motor candidato bajo contrato Copernic (2026-10-16)

El contrato COPERNIC_PREFIX_EXACT_PHRASE permanece CLOSED: TERM simple es prefijo de token; palabra entre comillas exacta; frase entre comillas exacta y posicional; sin stemming, lematización ni sinónimos. PostgreSQL-first queda REJECTED para esta arquitectura. EVAL2 ADOPT OpenSearch 2.19.6 como candidato para el sprint de integración; no es una implementación integrada.

Resultado sobre el mismo snapshot DEV de 17.077 documentos elegibles: igualdad exacta de IDs para 100/100 frases y 14/14 prefijos; las frases críticas responsabilidad civil (5.364) y falta de servicio (194) conservan IDs exactos. Combined p95: 81,84 ms y 109,65 ms. Golden existente: 319/319; fixtures nuevas: 12/12. Índice: 1.052.865.750 bytes; rebuild determinista: 4m44s.

OpenSearch es un índice derivado y descartable; PostgreSQL sigue como autoridad. ACL y publicación pasaron fixtures de consulta, pero sync de producción, autenticación/TLS, supervisión, fail-closed y despliegue seguro no están implementados. INT-1S: WAITING ENGINE INTEGRATION. INT-1R: BLOCKED. DEV NOT PROMOTED. Evidencia: _recovery-work/search-engine-eval2/.


## SEARCH-ENGINE-INTEGRATION-1.1 — estado de integración (2026-10-16)

El contrato COPERNIC_PREFIX_EXACT_PHRASE está implementado en el DSL OpenSearch y el matcher local; el rebuild versionado, alias estable, outbox/retry, verificador exacto e hidratación/reordenamiento de página desde PostgreSQL están presentes. La certificación final del índice dio 42.180 IDs exactos, Corpus 17.077/17.077 y sin faltantes/extras/duplicados. Outage recovery y rebuild race: PASS, con cero updates perdidos y backlog final 0.

Golden 325/325; frases 100/100 y prefijos 14/14 con sets exactos en el engine y comprobación de la primera página por adapter/hidratación. Para 30 ejecuciones adapter + PostgreSQL, p50/p95/max: responsabilidad civil 202,79/220,07/301,44 ms; falta de servicio 96,60/103,92/107,46 ms; 0 timeouts. Estos datos no certifican el endpoint NestJS completo. El controller conserva rutas/filtros con búsqueda legacy; la paridad de filtros/sorts, ACL y publicación engine-side, y fail-closed HTTP continúan pendientes. No declarar la integración lista para producción.
## Runbook operativo local OpenSearch (2026-10-16)

Ejecutar desde JurisprudenciaN/back. Los comandos search:* pasan por el guard DEV y requieren .env.development.local con PostgreSQL DEV local; no apuntarlos a producción ni a servidores institucionales.

Runtime local OpenSearch 2.19.6:
```powershell
pnpm opensearch:local:start
pnpm opensearch:local:status
pnpm opensearch:local:stop
```

Verificar salud, alias, índice físico, schema, integridad y outbox; reconstruir crea índice físico versionado, verifica y cambia el alias de forma atómica:
```powershell
pnpm search:opensearch:status
pnpm search:opensearch:verify
pnpm search:opensearch:rebuild
```

Sincronización y recuperación: ejecutar sync-once hasta backlog 0; retry-failed reencola los fallidos y luego volver a verificar:
```powershell
pnpm search:opensearch:sync-once
pnpm search:opensearch:retry-failed
pnpm search:opensearch:status
pnpm search:opensearch:verify
```

Limpieza: search:opensearch:cleanup conserva siempre el índice activo, el índice previo más reciente y cualquier índice con menos de 7 días; revisar el JSON antes de operar. No borrar manualmente el índice activo ni el directorio de datos como mecanismo de recuperación.
```powershell
pnpm search:opensearch:cleanup
```

Recuperación después de caída: iniciar el runtime, consultar status, procesar el outbox pendiente con sync-once/retry-failed, confirmar pending=0 y failed=0, y ejecutar verify. Si el alias o la integridad no pasan, detener la promoción y usar rebuild versionado; PostgreSQL sigue siendo la fuente de verdad. El runtime de integración quedó disponible en 127.0.0.1:9200 al cerrar esta certificación.

## SEARCH-ENGINE-INTEGRATION-1.2 — corte final bloqueado (2026-10-16)

**BLOCKED; no commit ni push.** El inventario de 31 rutas confirma que `/busqueda/avanzada` conserva búsqueda PostgreSQL para filtros/ordenamientos fuera del subconjunto V2; `/busqueda/simple` y `/public/busqueda` ejecutan PostgreSQL y OpenSearch en paralelo y conservan la respuesta legacy. Exportación, cita y `/sentencias/buscar`/`/sumarios/buscar` siguen siendo rutas de resultados legacy-only. Workspace y personal sí envían filtros de scope/ACL a OpenSearch; la matriz completa continúa sin certificar. Sugerencias/facetas, lookup de nombres y matches de un documento están identificados por separado.

HTTP real contra DEV local: `/api/public/busqueda?q=responsabilidad%20civil` devolvió 2 Sentencias publicadas/activas; OpenSearch devolvió 0. Ambas Sentencias están en estado `PUBLICADA` y no tienen Sumarios activos, así que no se confirmó fuga de borradores: se confirmó una brecha de cobertura entre la API legacy y la proyección por Sumario. Una segunda prueba seleccionó una Sentencia activa no publicada, buscó por su número vía la misma ruta pública y obtuvo total 0; el ID de la fixture no apareció. El censo directo registra 6.014 Sentencias activas/publicadas, ninguna representada por un Sumario activo/publicado. La proyección actual sigue teniendo 42.180 IDs exactos (Corpus 17.077 + Sumarios activos 25.103), cero faltantes/extras/duplicados y backlog 0; ese total no equivale a cobertura pública de Jurisprudencia.

Con OpenSearch inaccesible en un puerto de loopback no escuchado, la ruta pública respondió HTTP 503 controlado, sin stack. El handler aún inicia una llamada a la búsqueda legacy; por eso el fail-closed HTTP no certifica `legacy invocation count = 0`. Typecheck, build y Jest con DEV guard pasaron (32 suites/162 tests; 9 suites/21 tests omitidos). ESLint del conjunto Search (42 archivos) encontró 806 errores y cero warnings; el censo nuevo sí pasa lint y no se aplicó formato masivo. Falta completar cutover, cobertura de Sentencias publicadas, filtros/sorts, ACL/publicación, sincronización de procesamiento, pruebas HTTP, Viewer y demás gates de 1.2.

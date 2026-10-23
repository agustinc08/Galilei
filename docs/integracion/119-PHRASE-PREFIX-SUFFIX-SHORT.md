# 119 — PHRASE, PREFIX, SUFFIX y términos cortos

**Entorno:** Corpus DEV con proyección tokenizada lista. No son objetivos SLA institucionales.

| Familia | Candidatos | Verificación / conteo |
|---|---|---|
| PHRASE | Intersección de IDs que contienen cada token, usando `ILIKE` parametrizado para admitir puntuación guardada en el token | Verifica la frase contigua sobre `searchText` de una ventana ordenada; amplía la ventana si no alcanza para saber `hasMore`. NOT con frase conserva verificación global exacta para evitar falsos negativos. |
| PREFIX | `CorpusSearchToken.token LIKE 'prefijo%'` | Ventana ordenada y late hydration. |
| SUFFIX | `reverse(CorpusSearchToken.token) LIKE 'sufijoInvertido%'` | Válido, pero no se agregó columna invertida ni índice dedicado; EXPLAIN ve scan del conjunto de tokens. |
| SHORT (1–2 caracteres) | Ventana de documentos ordenada con `EXISTS` sobre tokens, evitando DISTINCT global de los ~750k tokens distintos | `ILIKE` sobre el token acota documentos; no los excluye como stopwords. Total puede ser aproximado y se expone `hasMore`/`totalExact`. |

El primer PHRASE optimizado exigía token igual al término. El read model conserva puntuación que `normalizeSearchText` permite, así que `753987.` no coincidía con candidato `753987`. El candidato ahora admite un superconjunto con `ILIKE '%token%'`; la verificación textual exacta descarta los falsos positivos. La integración de paquete sintético detectó y cubrió el caso; Corpus package PostgreSQL pasó 2/2 después de la corrección.

## Conteo y carga tardía

Para TERM/AND/OR y ventanas acotadas de la primera página, el adapter Corpus busca como máximo `pageSize+1` filas candidatas antes de cargar extracción, archivo, procedencia, colecciones, temas y etiquetas. `hasMore` mantiene navegación sin calcular el total exacto del corpus completo; el cliente distingue el valor aproximado/límite inferior con `totalExact`. El camino ZERO devuelve la página vacía sin hidratar. PHRASE informa conteo exacto sólo si el probe cubre todos los candidatos; si el total de candidatos supera la ventana, conserva `totalExact=false` y amplía cuando necesita suficientes coincidencias exactas. Para NOT puro no se aplica atajo vacío porque su universo válido es todo documento visible que no satisface el operando.

## Rendimiento de endpoint

Benchmark con warm-up y diez mediciones: PHRASE 1.400 ms p50 / 1.459 ms p95; PREFIX 456/577 ms; SUFFIX 965/1.169 ms; SHORT `de` 1.718/1.899 ms. No hubo errores de fuente. Los p95 del comparador directo pareado variaron algo más por carga de la máquina: PHRASE 1.594 ms, PREFIX 601 ms, SUFFIX 1.190 ms y SHORT 1.750 ms. El camino completo y el adapter directo dieron medianas próximas.

EXPLAIN ANALYZE cubrió los patrones candidatos y registró buffers. El GIN trigram existente ocupa 210.452.480 bytes (~200,7 MiB); índice por documento 78.184.448 bytes. Suffix usa `reverse(token)` calculado y no aprovechó un índice de expresión; no agregamos otra estructura de ese tamaño sin evidencia de que haga falta. El artefacto está en `_recovery-work/sprint123/plans/search-shapes.json`.

La PHRASE simple medida es positiva; expresiones complejas con PHRASE dentro de AND/OR usan generación de candidatos del AST y pueden hacer más trabajo. El gate permite seguir optimizando esos casos en DEV si mediciones reales lo ameritan. `NOT` puro requiere recorrer el universo visible y no equivale a una búsqueda positiva barata.

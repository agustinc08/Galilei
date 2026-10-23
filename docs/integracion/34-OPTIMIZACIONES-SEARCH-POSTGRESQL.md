# Optimizaciones PostgreSQL Search — Misión 5.4

**Estado:** implementadas en DEV, medidas contra la baseline del informe 33. No se cambió el AST, la gramática ni el schema.

## Cambio 1 — no recalcular un score lógico constante

**Problema y evidencia.** El adapter volvía a evaluar el mismo `LIKE` de cada término para computar `fullText` en cada fila que ya había pasado el predicado. Para OR, AND y consultas simples positivas, todo resultado necesariamente tiene una literal positiva coincidente; ese score era constante. La página ordenada de `daño` tardó 171.189 ms en el plan anterior y la fase página/ranking fue de 0.9–2.2 s según familia.

**Cambio.** `guaranteesPositiveLiteral` simplifica `fullText` a `1::numeric` sólo si la forma del AST garantiza al menos una literal positiva en cada rama coincidente. `guaranteesMatch` simplifica el score de frase sólo cuando esa frase está garantizada. Fórmulas con una alternativa `NOT` conservan cálculo fila por fila. Se mantiene el mismo `score`, `scoreComponents` y orden; los valores de usuario siguen parametrizados.

**EXPLAIN y benchmark.** Página ordenada de `daño`: 171.189 → 31.570 ms en `EXPLAIN ANALYZE` (−81.6%). Página/ranking p50: TERM 1032.6 → 87.8 ms; OR 1722.7 → 95.2 ms; booleano complejo 2184.9 → 83.7 ms. Prueba PostgreSQL cubre OR positivo y `daño OR NOT zzzxqv` para proteger scores 1/0.

**Schema/índice.** Ninguno.

## Cambio 2 — candidatos trigram para sufijo simple

**Problema y evidencia.** `LIKE '%accident %'` apareció dentro de un OR sobre columnas de dos tablas unidas; el plan hacía scans aunque existían GIN trigram. El plan unido de referencia tardó 198.700 ms. Aislados, los índices existentes resolvieron la consulta por bitmap scans.

**Cambio.** Para una sola literal moderna, no cualificada, tipo TERM, sufijo y longitud de al menos tres caracteres, el adapter forma un CTE de IDs con `UNION` entre coincidencias de Sumario y de Sentencia. `UNION` elimina duplicados cuando ambos textos coinciden; el join y los filtros activos se conservan. La ruta SQL usa parámetros y se aplica igual a `search()` y `searchIds()`. Otros AST y términos cortos mantienen la ruta general.

**EXPLAIN y benchmark.** La consulta equivalente por unión de candidatos usó `Bitmap Index Scan` en `idx_sumario_texto_busqueda_norm_trgm` y `idx_sentencia_texto_busqueda_norm_trgm`, y midió 2.719 ms para el caso vacío. La búsqueda `%accident` completa pasó de 1621.4 ms p50 / 1668.2 ms p95 a 8.7 / 9.4 ms (−99.5% p50). También medimos el sufijo con coincidencias `%civil`: 15.283 resultados; 20 repeticiones dieron p50 870.9 ms, p95 932.8 ms y max 972.4 ms. Ese caso confirma que el outlier no se oculta y que la ruta sigue bajo el gate temporal. Ver planes antes y después en `34-explain-before-postgresql.json` y `34-explain-after-postgresql.json`.

**Schema/índice.** Ninguno. Se aprovechan los GIN ya instalados: Sumario 70 MiB y Sentencia 17 MiB. No se crean índices redundantes ni migraciones nuevas.

## Límites y riesgos restantes

- El COUNT continúa siendo la mayor etapa para TERM, PHRASE, NOT y PREFIX; sus p50 finales están entre 0.55 y 0.98 s en estas consultas.
- Los GIN no fueron elegidos por los planes de OR amplios entre tablas; el tamaño de fixture y su selectividad pueden influir. No se añadieron índices sin beneficio demostrado.
- `de` y `a` quedan con scan, deliberadamente; no hay suficientes trigramas para una ruta GIN útil.
- El campo numérico `1113` es una búsqueda candidata, no prueba de un filtro exacto por identificador legal.
- `numeroSentencia:1113` se midió como consulta de campo: 20 resultados, p50 55.6 ms, p95 148.1 ms, max 163.8 ms. Su plan local hace Seq Scan sobre Sentencia porque el adapter normaliza la columna dentro de una expresión; el índice B-tree de la columna no es aplicable a esa expresión. No se añadió un índice funcional no representado por Prisma; validar escala y decidir una migración si ese caso es prioritario.
- Corpus de 46.247 filas; falta validar volumen institucional/prod y carga concurrente.

## Archivos de evidencia

- Baseline y etapa final: `33-performance-baseline-postgresql.json`, `35-performance-final-postgresql.json`.
- Planes: `34-explain-before-postgresql.json`, `34-explain-after-postgresql.json`.
- Paridad: `35-benchmark-parity-postgresql.json`.

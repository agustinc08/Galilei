# Baseline de performance PostgreSQL Search — Misión 5.4

**Fecha:** 2026-10-07 · **Estado:** BASELINE MEDIDA ANTES DE OPTIMIZAR · **DB:** sólo DEV local.

## Entorno y corpus

- Windows 11 Home x64, build 10.0.26300; Intel Core i7-13620H (13.ª generación), 15.7 GiB RAM.
- PostgreSQL 16.15 en `127.0.0.1:55432`, DB `buscador_juridico_civil_dev`, rol `bjc_dev`.
- Corpus de compatibilidad DEV: 21.109 sentencias y 25.138 sumarios importados de SQLite legacy; 1 huérfano excluido. `tb_microisis` no se importó.
- SQLite de origen se abrió read-only, immutable y query-only. Benchmark original de 40 casos sólo se leyó.
- Tamaño moderado: 46.247 filas entre Sentencia y Sumario; no demuestra escala productiva.

## Método

- 13 consultas representativas: candidato numérico, TERM, PHRASE, AND, OR, NOT, FIELD, PREFIX, SUFFIX, booleano complejo, ranking moderno y palabras cortas `de`/`a`.
- 2 warm-ups descartados y 8 repeticiones medidas por familia; page size 25.
- Se separó parseo, total SQLite, `COUNT` PostgreSQL y página/ranking PostgreSQL mediante temporizadores del adapter. `p95` usa nearest-rank; con ocho muestras coincide con el máximo. Los JSON guardan la medición completa resumida por familia.
- La consulta `1113` es un candidato numérico de búsqueda. Se midió por separado `numeroSentencia:1113` después de optimizar; el baseline de familias conserva el caso original y no atribuye una ruta exacta que no se midió antes.

## Baseline de latencia

Milisegundos. `p95 = max` en esta muestra de ocho repeticiones por familia.

| Familia | Caso | p50 | p95 | max | COUNT p50 | Página/ranking p50 |
|---|---|---:|---:|---:|---:|---:|
| Identificador candidato | BJC-022 | 1197.4 | 1294.5 | 1294.5 | 515.4 | 677.1 |
| TERM | BJC-001 | 1566.6 | 1592.7 | 1592.7 | 537.0 | 1032.6 |
| PHRASE | BJC-008 | 2051.1 | 2082.5 | 2082.5 | 894.2 | 1159.6 |
| AND | BJC-005 | 1685.6 | 1753.8 | 1753.8 | 717.3 | 962.0 |
| OR | BJC-006 | 2482.2 | 2507.7 | 2507.7 | 758.7 | 1722.7 |
| NOT | BJC-007 | 2359.2 | 2416.0 | 2416.0 | 942.3 | 1413.5 |
| FIELD | BJC-033 | 1527.4 | 1537.4 | 1537.4 | 516.4 | 1000.6 |
| PREFIX | BJC-009 | 1930.3 | 1969.8 | 1969.8 | 836.7 | 1095.2 |
| SUFFIX | BJC-010 | 1621.4 | 1668.2 | 1668.2 | 728.8 | 897.9 |
| Booleano complejo | BJC-054 | 2956.4 | 2980.5 | 2980.5 | 759.9 | 2184.9 |
| Texto con ranking | BJC-011 | 1517.4 | 1544.7 | 1544.7 | 586.9 | 929.6 |
| Término corto `de` | BJC-020 | 509.0 | 550.6 | 550.6 | 346.5 | 161.3 |
| Término corto `a` | BJC-021 | 499.7 | 522.6 | 522.6 | 340.5 | 161.3 |

La mediana de los 13 p50 por familia fue **1621.4 ms**. El peor p50 y p95 fueron del booleano complejo: **2956.4 / 2980.5 ms**. El parseo tuvo p50 sub-milisegundo; un máximo aislado de 1.253 ms no explica las latencias de búsqueda.

## Peores casos y evidencia SQL

1. Booleano complejo, 2.956 s p50; la página/ranking consumió 2.185 s.
2. OR, 2.482 s; página/ranking 1.723 s.
3. NOT, 2.359 s; página/ranking 1.413 s.
4. PHRASE, 2.051 s; página/ranking 1.160 s.
5. PREFIX, 1.930 s; página/ranking 1.095 s.

`EXPLAIN (ANALYZE, BUFFERS, VERBOSE)` de la consulta moderna con score repetido eligió `Limit` sin índice y tardó 171.189 ms en el plan caliente de `daño`; el count equivalente usó scan/join y registró 158.787 ms en esa corrida. El predicado sufijo unido con OR entre tablas eligió scans y registró 198.700 ms. Los valores de `search()` de pared son más altos porque miden cada llamada completa, conexión/ejecución, count y materialización.

Había índices GIN trigram de 17 MiB en Sentencia y 70 MiB en Sumario para el texto normalizado; el índice de Sumario no registraba scans antes de la optimización. El plan SQL detallado y catálogo de índices están en [`34-explain-before-postgresql.json`](34-explain-before-postgresql.json).

## Archivo de datos

[`33-performance-baseline-postgresql.json`](33-performance-baseline-postgresql.json) conserva las 13 familias, sus ocho repeticiones resumidas, hardware y etapas separadas.

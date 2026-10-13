# Search Benchmark V2 — Sprint 12.2

**Fecha:** 2026-10-08 · **Destino de datos:** sólo `bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev`.

## Criterio

El benchmark de API ejecutó tres mediciones por familia más warmup (15 familias disponibles; TOPIC/TAG no disponibles). El benchmark del adapter Corpus ejecutó cinco mediciones por familia. No guardan el texto consultado. Como tres mediciones dan percentiles orientativos, no deben tratarse como SLO.

## Referencia anterior y API Sprint 12.2

La referencia anterior es el baseline histórico de Sprint 12.1 (10 mediciones); la comparación es orientativa porque cambia el número de repeticiones y el código instrumentado.

| Familia | Antes p50 | Después API p50 | API p95 | Juri p50 | Corpus p50 | Errores Corpus |
|---|---:|---:|---:|---:|---:|---:|
| TERM común | 6.26 s | 5.91 s | 6.71 s | 195 ms | 251 ms | 0/3 |
| TERM raro | — | 7.22 s | 7.26 s | 6 ms | 21 ms | 0/3 |
| PHRASE | 7.68 s | 7.40 s | 7.45 s | 4 ms | 2.64 s | 1/3 |
| AND | — | 2.85 s | 12.23 s | 232 ms | 230 ms | 0/3 |
| OR | — | 2.76 s | 12.06 s | 229 ms | 181 ms | 0/3 |
| NOT con positivo | — | 7.10 s | 7.44 s | 376 ms | 509 ms | 0/3 |
| NOT puro | — | 1.11 s | 1.14 s | 20 ms | 209 ms | 0/3 |
| FIELD | — | 197 ms | 229 ms | 3 ms | 39 ms | 0/3 |
| PREFIX | — | 5.50 s | 5.51 s | 273 ms | 2.32 s | 1/3 |
| SUFFIX | — | 4.04 s | 4.07 s | 958 ms | 4.04 s | 3/3 |
| SHORT (`de`) | — | 2.07 s | 2.09 s | 1.15 s | 2.07 s | 0/3 |
| IDENTIFIER | — | 33 ms | 41 ms | 4 ms | 33 ms | 0/3 |
| ZERO | 6.90 s | 6.93 s | 6.98 s | 7 ms | 7 ms | 0/3 |
| COMPLEX BOOLEAN | 14.77 s | 3.50 s | 13.19 s | 265 ms | 220 ms | 0/3 |
| Colección | 5.01 s | 159 ms | 273 ms | — | 159 ms | 0/3 |

Los tiempos Juri/Corpus son del fan-out federado. El total de `/api/busqueda/avanzada` todavía espera en paralelo la búsqueda legacy que llena el contrato superior de Jurisprudencia; ese camino sostiene p50 de 5–7 s en las familias habituales. El adapter rápido, por sí solo, no hace rápido al endpoint.

## Adapter Corpus aislado

| Familia | p50 | p95 | Errores |
|---|---:|---:|---:|
| TERM común | 48 ms | 49 ms | 0/5 |
| TERM raro | 19 ms | 20 ms | 0/5 |
| ZERO | 2 ms | 3 ms | 0/5 |
| SHORT | 2.13 s | 2.19 s | 0/5 |
| NUMERIC | 184 ms | 244 ms | 0/5 |
| PHRASE | 2.79 s | 4.05 s | 2/5 |
| AND / OR / NOT | 244–441 ms | 324–523 ms | 0/5 |
| COMPLEX | 499 ms | 539 ms | 0/5 |
| FIELD | 151 ms | 162 ms | 0/5 |
| PREFIX | 2.31 s | 4.02 s | 2/5 |
| SUFFIX | 4.06 s | 4.06 s | 5/5 |
| IDENTIFIER | 9 ms | 9 ms | 0/5 |

`PHRASE`, `PREFIX` y `SUFFIX` fallaron por SQLSTATE `57014` bajo el timeout ya vigente. El plan diagnóstico del texto largo observó rechecks GIN sobre miles de documentos: PHRASE revalidó 5.435 filas del índice y consumió 8,57 s en heap; PREFIX ~11,69 s y SUFFIX ~15,08 s. La variante que materializa primero documentos candidatos redujo PHRASE/PREFIX, pero no cumplió sus objetivos; SUFFIX siguió expirando.

## Artifacts reproducibles

- API: `_recovery-work/sprint122/performance/after/search-benchmark.json`
- Corpus: `_recovery-work/sprint122/performance/corpus-adapter.json`
- Planes y tamaños: `_recovery-work/sprint122/plans/term-and-field-explain.json`
- Paridad: doc 111 y su carpeta `parity/`.

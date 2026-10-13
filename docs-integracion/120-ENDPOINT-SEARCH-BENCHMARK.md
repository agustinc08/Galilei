# 120 — Benchmark del endpoint visible

**Destino:** PostgreSQL 16.15 `bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev`. Diez repeticiones medidas más una de calentamiento por familia; perfil sólo DEV. Se suprimieron eventos de consulta y no se persistió el texto consultado.

| Familia | Engine por fuente | p50 ms | p95 ms | HTTP / errores de fuente |
|---|---|---:|---:|---|
| TERM común | V2 Juri + Corpus | 118,60 | 234,30 | 200 / 0 |
| TERM raro | V2 Juri + Corpus | 26,98 | 40,25 | 200 / 0 |
| ZERO | V2 Juri + Corpus | 15,80 | 18,51 | 200 / 0 |
| PHRASE | V2 Juri + Corpus | 1.400,29 | 1.459,31 | 200 / 0 |
| PREFIX | V2 Juri + Corpus | 455,56 | 576,59 | 200 / 0 |
| SUFFIX | V2 Juri + Corpus | 964,85 | 1.168,82 | 200 / 0 |
| SHORT (`de`) | V2 Juri + Corpus | 1.717,68 | 1.898,85 | 200 / 0 |
| AND | V2 Juri + Corpus | 731,71 | 799,91 | 200 / 0 |
| OR | V2 Juri + Corpus | 1.174,22 | 1.226,99 | 200 / 0 |
| NOT positivo | V2 Juri + Corpus | 1.003,47 | 1.077,76 | 200 / 0 |
| NOT puro | V2 Juri + Corpus | 820,28 | 1.134,41 | 200 / 0 |
| FIELD | V2 Juri + Corpus | 1.698,45 | 2.114,96 | 200 / 0 |
| IDENTIFIER exacto | V2 Juri + Corpus | 20,45 | 43,24 | 200 / 0 |
| COMPLEX boolean | V2 Juri + Corpus | 1.786,71 | 1.875,26 | 200 / 0 |
| Filtro colección | V2 Corpus-only | 77,26 | 184,04 | 200 / 0 |

En las 15 familias se observó `engine=v2`, `legacyMs=0`, sin errores de las fuentes. No se afirma que todos los filtros avanzados de UI estén en V2: los no representados continúan híbridos según doc 117. FIELD p95 queda apenas por encima del objetivo orientativo de 2 s; el benchmark orienta DEV, no es SLA.

## Comparación del hot path

En comparaciones emparejadas, el servicio federado directo y el endpoint avanzado dieron medianas similares para TERM, PHRASE, PREFIX, SUFFIX y SHORT. El endpoint no volvió al costo legacy: `legacyMs=0`. Evidencia: `_recovery-work/sprint123/performance/path-comparison.json`; benchmark completo: `_recovery-work/sprint123/performance/after/search-benchmark.json`.

No se compara aquí latencia de una red productiva, TLS, proxy, WAN ni dispositivos cliente.

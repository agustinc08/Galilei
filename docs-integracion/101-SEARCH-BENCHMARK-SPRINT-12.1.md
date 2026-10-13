# 101 — Benchmark Search (Sprint 12.1)

Benchmark del mismo DEV/corpus y rutas, 1 warmup + 10 mediciones por familia. p50/p95 son milisegundos end-to-end. El porcentaje indica cambio de p50 (`+` = mejora). Ninguna familia autoriza READY.

| Familia | p50 antes | p50 después | Cambio p50 | p95 antes | p95 después |
|---|---:|---:|---:|---:|---:|
| TERM común | 6.819 | 6.262 | +8,2% | 6.968 | 6.415 |
| TERM raro | 7.156 | 6.713 | +6,2% | 7.289 | 7.006 |
| PHRASE | 7.945 | 7.676 | +3,4% | 8.054 | 7.771 |
| AND | 13.579 | 10.179 | +25,0% | 14.367 | 12.632 |
| OR | 13.104 | 7.053 | +46,2% | 13.525 | 12.308 |
| NOT + positivo | 13.901 | 7.984 | +42,6% | 14.254 | 13.027 |
| NOT puro | 7.374 | 6.849 | +7,1% | 7.475 | 6.929 |
| FIELD | 884 | 865 | +2,2% | 912 | 903 |
| PREFIX | 6.314 | 5.972 | +5,4% | 7.541 | 6.061 |
| SUFFIX | 4.050 | 4.053 | -0,1% | 4.070 | 4.065 |
| SHORT | 5.006 | 4.007 | +19,9% | 5.011 | 4.020 |
| IDENTIFIER exacto | 15 | 26 | -76,3% | 17 | 35 |
| ZERO | 6.923 | 6.693 | +3,3% | 7.105 | 6.790 |
| Boolean complejo | 20.250 | 14.774 | +27,0% | 20.709 | 16.821 |
| Collection | 5.007 | 2.808 | +43,9% | 5.014 | 4.015 |

La reducción en AND/OR/NOT/COMPLEX es material, pero común/raro/frase siguen en varios segundos. IDENTIFIER empeoró desde una base pequeña. Corpus falló con SQLSTATE `57014` en common 5/10, rare 5/10, phrase 5/10, AND 10/10, OR 10/10, NOT+positive 10/10, NOT puro 10/10, prefix 5/10, suffix 10/10, short 7/10, complex 10/10 y collection 5/10. FIELD, identifier y zero no fallaron. No se aumentó el timeout.

Los JSON completos, perfiles por fase, fingerprints, errores SQLSTATE y disponibilidad de filtros están en `_recovery-work/sprint121/performance/before/search-benchmark.json` y `after/search-benchmark.json`. `topic` y `tag` no tuvieron documentos elegibles para probarlos. SQL/params/texto no se guardaron.

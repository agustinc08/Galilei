# 102 — Concurrencia y pool (Sprint 12.1)

Carga local en handlers Nest in-process; 20 solicitudes por usuario, mezcla 60% Search, 15% dashboard, 15% detalle y 10% archivo/rangos o matches. No representa TLS, proxy ni red compartida.

| Usuarios | Solicitudes | Duración ola | Throughput | Search p50 / p95 / max | errores HTTP Search | errores de fuente Search | pool wait máximo Prisma / Corpus | RSS pico |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 20 | 70,9 s | 0,28/s | 6,33 / 6,68 / 6,68 s | 0 | 6 | 0 / 0 | 711 MiB |
| 5 | 100 | 195,9 s | 0,51/s | 10,42 / 30,13 / 48,41 s | 2 | 48 | 7 / 7 | 784 MiB |
| 10 | 200 | 285,4 s | 0,70/s | 12,72 / 45,57 / 103,58 s | 2 | 106 | 13 / 17 | 816 MiB |
| 20 | 400 | 493,2 s | 0,81/s | 24,47 / 47,49 / 284,33 s | 5 | 224 | 109 / 37 | 839 MiB |

Con 10 usuarios, dashboard p95 21,7 s y detalle p95 45,5 ms. Con 20, detalle p95 28,4 s; archivo/range p95 1,78 s y matches p95 2,36 s. Node llegó a 58,4% de un core durante la ola de 20 y el pool Prisma tuvo máximo configurado 10; PostgreSQL reportó máximo 17 conexiones de esta base.

Los snapshots de pool son muestreos concurrentes no atómicos: en algunas muestras `active + idle` supera `total`; usar `waiting` como señal de saturación, no inferir un balance de conexiones exacto de esos tres campos. En ola de 20, Prisma llegó a 109 en espera y Corpus a 37. Node emitió `MaxListenersExceededWarning` durante esa carga; RSS máximo medido fue 839 MiB. Resultado: gate de concurrencia FAIL con margen amplio.

Artefacto: `_recovery-work/sprint121/performance/concurrency-results.json`.

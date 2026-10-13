# Resultado Sprint 12.3 — Search Hot Path V2

**Fecha:** 2026-10-08 · **Destino:** PostgreSQL 16.15 DEV, `bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev`.

## Dictamen

**READY WITH NON-BLOCKING ADJUSTMENTS** para continuar con preproducción controlada y UAT institucional. **No habilita producción ni red compartida.** `HUMAN ACCEPTANCE=PENDING`; ACL institucional/export Digesto `PENDING`; CIJ/CSJN automatizado `NO GO`.

## Cambio de integración

La pantalla `/busqueda-avanzada` llega al controller Nest y, para consultas cubiertas, el controller invoca el servicio federado V2 sin iniciar la búsqueda legacy. El endpoint conserva el contrato superior `data`/`meta` más `federated`; el tracking se preserva. Quince familias del benchmark reportaron `engine=v2`, `legacyMs=0`, HTTP 200 y cero errores de fuente. Los filtros avanzados no cubiertos permanecen en fallback híbrido; el detalle está en doc 117.

Se añadió comparación directa vs endpoint, y un Playwright que inicia sesión como LECTOR, ejecuta una consulta normal y verifica resultados completos. También se conserva la navegación por colección y la apertura del documento con realce PDF.

## Optimizaciones

- Corpus pool raw: máximo pasó de 3 a 8. La medición inicial presentó 47 errores de fuente a 20 usuarios; la repetición a 10/20 llegó a cero. Matriz final completa 1/5/10/20: cero HTTP/source errors; Corpus pool wait máximo cero.
- PHRASE: candidatos tokenizados con tolerancia a puntuación y comprobación exacta sobre texto; corrigió falso negativo `753987.` detectado por la suite de paquete.
- PREFIX usa candidato token `LIKE`; SUFFIX evalúa token invertido sin índice adicional; SHORT 1–2 caracteres usa `EXISTS` en una ventana ordenada y sigue admitido.
- No se agregó proyección física Jurisprudencia ni migración/indexes Sprint 12.3: la tabla fuente V2 da latencias compatibles con los datos DEV medidos. No se declara eliminado todo scan del SQL relacional.

## Resultados

La comparación siguiente es orientativa: Sprint 12.1 midió 10 repeticiones, 12.2 tres, y Sprint 12.3 diez, con cambios de instrumentación y de ruta visible.

| Familia | Sprint 12.1 p50 ms | Sprint 12.2 p50 ms | Sprint 12.3 p50 ms |
|---|---:|---:|---:|
| TERM común | 6.262 | 5.910 | 119 |
| TERM raro | 6.713 | 7.220 | 27 |
| ZERO | 6.693 | 6.930 | 16 |
| PHRASE | 7.676 | 7.400 | 1.400 |
| PREFIX | 5.972 | 5.500 | 456 |
| SUFFIX | 4.053 | 4.040 | 965 |
| SHORT (`de`) | 4.007 | 2.070 | 1.718 |
| AND | 10.179 | 2.850 | 732 |
| OR | 7.053 | 2.760 | 1.174 |
| NOT + positivo | 7.984 | 7.100 | 1.003 |
| NOT puro | 6.849 | 1.110 | 820 |
| FIELD | 865 | 197 | 1.698 |
| IDENTIFIER exacto | 26 | 33 | 20 |
| COMPLEX BOOLEAN | 14.774 | 3.500 | 1.787 |
| Colección | 2.808 | 159 | 77 |

La latencia de FIELD subió frente a Sprint 12.2 al quitar la ejecución legacy del endpoint; p50 queda 1,70 s y p95 2,11 s, por encima del objetivo orientativo. Se conserva como ajuste no bloqueante para el siguiente análisis de planes/indexación. No se añadió índice sin EXPLAIN que justifique la duplicación.

| Familia | p50 ms | p95 ms |
|---|---:|---:|
| TERM común / raro / ZERO | 118,60 / 26,98 / 15,80 | 234,30 / 40,25 / 18,51 |
| PHRASE / PREFIX / SUFFIX / SHORT | 1.400 / 456 / 965 / 1.718 | 1.459 / 577 / 1.169 / 1.899 |
| AND / OR / NOT positivo / NOT puro | 732 / 1.174 / 1.003 / 820 | 800 / 1.227 / 1.078 / 1.134 |
| FIELD / IDENTIFIER / COMPLEX | 1.698 / 20 / 1.787 | 2.115 / 43 / 1.875 |
| Colección | 77 | 184 |

La comparación emparejada directa/endpoint tuvo medianas próximas: TERM 115/114 ms, PHRASE 1.551/1.530 ms, PREFIX 496/485 ms, SUFFIX 1.018/1.033 ms, SHORT 1.724/1.719 ms. Artifacts privados en `_recovery-work/sprint123/performance/`.

| Concurrencia | Search p50/p95 | Errores HTTP/fuente | Throughput total |
|---|---:|---:|---:|
| 1 usuario, 20 req | 129/259 ms | 0/0 | 8,88 req/s |
| 5 usuarios, 100 req | 414/1.331 ms | 0/0 | 11,93 req/s |
| 10 usuarios, 200 req | 1.886/2.619 ms | 0/0 | 8,96 req/s |
| 20 usuarios, 400 req | 3.730/4.284 ms | 0/0 | 8,43 req/s |

Prisma waiting peak llegó a 123 en la ola de 20; medir nuevamente con topología objetivo. Comparación local in-process, sin TLS/proxy/WAN.

## Validación y recuperación

- PostgreSQL: 20/20 migraciones, status limpio, schema 44 tablas, `pg_trgm 1.6`.
- Corpus projection: 11.008 documentos, 9.475.712 tokens, 0 stale; sample 100/100; rebuild idempotente no requerido para cerrar.
- Paridad: 40/40 PASS_COMPAT, cero diferencias reportadas.
- Backend: suite común 86 PASS, 15 opt-in omitidos; suites dirigidas Postgres 7/7, Corpus 3/3 y paquete 2/2 PASS; TypeScript/Nest build PASS.
- Frontend: TypeScript/Next build PASS; Playwright 5/5 PASS.
- Backup final dual SHA: custom 292.430.265 bytes, `77a7c488…ad8c19`; SQL UTF-8 1.207.928.742 bytes, `08635236…1fbf32` (doc 123).
- Restore real y DB desde cero permanecen PASS histórico de Sprint 12.1 (docs 103/104). Schema replay 20 migraciones Sprint 12.2 es una tercera prueba adicional. DEV principal nunca fue destino del restore.

## Próximo

**Sprint 13 — preproducción controlada + UAT institucional**, con concurrencia sobre topología real, aprobación ACL/anonimización/retención y aceptación humana. Mantener servicios y datos limitados a DEV hasta cerrar esos gates. Si FIELD u otra familia excede el SLO que acuerde la institución, volver a medir y optimizar; con esta evidencia no corresponde abrir ADR ni migrar a motor externo.

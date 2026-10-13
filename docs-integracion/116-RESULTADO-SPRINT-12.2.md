# Resultado Sprint 12.2 — Search Engine V2

**Fecha:** 2026-10-08 · **Destino único:** PostgreSQL 16.15 `bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev`.

## Estado inicial

Sprint 12.1 reportó TERM común 6,26 s p50, PHRASE 7,68 s, BOOLEAN complejo 14,77 s; 10 usuarios Search p95 45,57 s con errores. El schema estaba en 17 migraciones.

## Cambios implementados

- AST compartido, generación de candidatos por literal y operaciones `INTERSECT`/`UNION`/`EXCEPT` en adapters PostgreSQL.
- Proyección derivada de tokens Corpus, triggers transaccionales, rebuild/verify/repair guardados e indicador readiness. Sin rebuild en startup.
- Corpus limita la ventana a `pageSize + 1`, hidrata después del límite, difiere total y devuelve `hasMore`/`totalExact`; fallos federados son visibles como parciales.
- La verificación de PHRASE/PREFIX materializa candidatos de documento antes del texto exacto. Mejora las medianas, pero persisten expiraciones; SUFFIX requiere otra estrategia.
- Corregidos literales SQL `ESCAPE` en Corpus y búsqueda legacy; agregadas aserciones. Corregida la ruta de salida del benchmark Sprint 12.2 y el verificador de schema obsoleto.
- El harness de concurrencia ahora escucha en loopback una vez, evitando listeners `close` por request de Supertest.

## Proyección y base

| Medida | Resultado |
|---|---:|
| Documentos | 11.008 |
| Tokens distintos por documento | 9.475.712 |
| Stale / muestra | 0 / 100 sin diferencias |
| GIN `CorpusSearchToken_token_trgm_idx` | 210.452.480 bytes (~200,7 MiB) |
| DB final | 2.277.792.791 bytes |
| Rebuild inicial | 11.008 docs; PASS |
| Rebuild idempotente | 0 docs; PASS |
| Migraciones | 20/20; status limpio |

## Resultado medido

Jurisprudencia adapter V2 tiene TERM común alrededor de 195 ms p50, FIELD 3 ms e IDENTIFIER 4 ms en la API federada. Corpus directo obtiene TERM común 48 ms, raro 19 ms, ZERO 2 ms, AND/OR/NOT 244–441 ms y COMPLEX 499 ms. Sin embargo, `/api/busqueda/avanzada` también calcula y espera el camino legacy para construir el contrato superior; éste tarda alrededor de 5–7 s en términos comunes/raros y resultado vacío. Hay una brecha de integración pendiente entre el adapter rápido y la ruta visible.

PHRASE, PREFIX y SUFFIX de Corpus activan rechecks costosos del texto largo; después de materializar candidatos, todavía hubo timeouts en 9/15 mediciones de esas tres familias. SHORT `de` p50 2,13 s. La evidencia no permite afirmar que PostgreSQL no alcance el objetivo con otra proyección; sí demuestra que la ruta actual no cumple.

## Paridad y ranking

40/40 PASS_COMPAT; 11/11 casos semánticos extendidos sin diferencias de IDs ni orden en primera página; FIELD 1/1. El smoke aislado reprodujo 20 migraciones en schema dedicado, 43 tablas y verificó trigger/term/phrase, luego eliminó el schema. No equivale a restore ni a una base vacía.

## Concurrencia

Mix 1/5/10/20 usuarios: Search p95 6,33/24,58/35,65/35,94 s; 0/0/11/6 HTTP errors; picos de espera Prisma 0/2/35/80. A 20 usuarios, max Search 261,45 s. El warning de listeners fue del harness y se corrigió; smoke de harness con 20 búsquedas simultáneas terminó sin warning ni errores HTTP.

## Validación y backup

- Backend: 19 suites y 81 tests PASS; 15 pruebas opt-in omitidas por corrida estándar. PostgreSQL adapter 7/7, paridad dirigida 1/1, Corpus 3/3, paquete 2/2; smoke migration/schema PASS.
- Backend/frontend TypeScript PASS; Nest build PASS; Next build PASS; Playwright 4/4.
- Backup previo a migration20: custom 292.428.808 bytes SHA `e3c73bd61e2521b19032e51ea0e28b8dab467a415b396348e985d853bc600402`; SQL 1.207.926.911 bytes SHA `c8d1a34545f4339cd3539c967b698d47c87e896e80ed8ae4cdf8683649a5a7be`.
- Backup final: custom 292.430.212 bytes SHA `32843ff1f95c51359b2f373f79a17a72f5c90cda391d4e7335bf762e8dd8c9fa`; SQL 1.207.928.039 bytes SHA `5b4f7de6f5a640f554a4dea857b65a5f3d8d948cb74e737a2119ad31c218b3c4`.
- Corrección editorial Sprint 12.3: la restauración real y la DB vacía sí se probaron en Sprint 12.1 según evidencia 103/104. Restore por `psql` a DB temporal, conteos/hash y smoke SQL PASS; `prisma migrate deploy` desde DB temporal vacía 17/17, fixture/search/cleanup PASS. Las restricciones a `pg_restore` y `CREATEDB` explicaron el método y el primer bloqueo, pero no describen el estado final. Ningún restore se hizo sobre DEV principal.

## Documentación

Docs 107–110 y 114 describen arquitectura, read model, operador booleano, late hydration y runbook. Docs 111–113 registran paridad, benchmark y carga. Este documento y doc 115 fijan el cierre/gate.

## Dictamen y próximo trabajo

**TECHNICAL PREPRODUCTION — NOT READY.** El siguiente trabajo debe integrar el ejecutor V2 con el endpoint legacy visible conservando filtros y contrato, y diseñar candidatos baratos para PHRASE/PREFIX/SUFFIX/SHORT sin recheck masivo. Repetir benchmarks y carga antes de reconsiderar un motor externo; el adapter V2 rápido no demuestra incapacidad intrínseca de PostgreSQL.

HUMAN ACCEPTANCE permanece PENDING. ACL y export Digesto PENDING; automatización CIJ/CSJN NO GO. DEV local únicamente.

> El dictamen y el plan anterior son el corte histórico de Sprint 12.2. Sprint 12.3 integró el endpoint, optimizó las familias críticas y obtuvo nuevo gate; ver docs 117–125, especialmente 124–125.

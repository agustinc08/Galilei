# Preproduction Gate — Sprint 12.2

**Fecha:** 2026-10-08 · **Entorno:** PostgreSQL local DEV. No es aprobación institucional.

## Dictamen técnico

# TECHNICAL PREPRODUCTION — NOT READY (dictamen histórico Sprint 12.2)

La paridad funcional y los builds pasan, pero los objetivos de latencia y concurrencia no. TERM común del endpoint p50 5,91 s; PHRASE 7,40 s; resultado vacío 6,93 s; Search p95 a 10 usuarios 35,65 s con 11 HTTP errors. A 20 usuarios, el máximo fue 261,45 s con 6 HTTP errors. Corpus todavía expira en PHRASE/PREFIX/SUFFIX y mantiene `de` alrededor de 2,13 s.

## Gates

| Gate | Estado | Evidencia |
|---|---|---|
| Guard DB DEV exacto | PASS | `127.0.0.1:55432`, `buscador_juridico_civil_dev`, `bjc_dev` |
| Migraciones operativas | PASS | 20/20 aplicadas; status limpio |
| Schema verify | PASS | 44 tablas, `pg_trgm 1.6`, fixture 21.109/25.138 |
| Projection rebuild/verify | PASS | 11.008 documentos, 9.475.712 tokens, 0 stale, muestra 100/100 |
| Rebuild idempotente | PASS | 0 documentos reconstruidos al repetir |
| Paridad Juri | PASS | 40/40 compatible; extended 11/11 y FIELD 1/1 |
| Backend tests | PASS | 81 tests en suite; 15 opt-in omitidos allí, opt-ins dirigidos pasaron |
| Backend/front typecheck y build | PASS | Nest y Next |
| Playwright | PASS | 4/4 |
| Search/API latency | FAIL | Tabla doc 112; ruta legacy sigue en segundos |
| Corpus PHRASE/PREFIX/SUFFIX | FAIL | SQLSTATE 57014 en 9/15 mediciones combinadas |
| Concurrencia 10/20 | FAIL | 11/6 errores HTTP; p95 ~35,6/35,9 s |
| Restore real / DB vacía | PASS histórico Sprint 12.1 | Docs 103/104: restore y migration-from-zero en DB temporales con verificación y cleanup. Sprint 12.2 además probó schema replay aislado de 20 migraciones. |
| Backup final | PASS | Dumps duales con SHA en doc 116 |

## Separación de aceptación

- HUMAN ACCEPTANCE: **PENDING**.
- ACL institucional: **PENDING**.
- Export/crosswalk Digesto: **PENDING**.
- CIJ/CSJN automatizado: **NO GO** según política vigente.

El piloto continúa exclusivamente local y acompañado. No habilitar red compartida ni declarar capacidad institucional.

## Corrección editorial Sprint 12.3

La fila anterior que indicaba `PENDING/BLOCKED` mezcló restricciones de herramientas con estado de las pruebas y contradice evidencia primaria posterior ya documentada en 103/104. El restore real por `psql` y la DB temporal desde cero pasaron durante Sprint 12.1; sus destinos de prueba se limpiaron. Sprint 12.2 agregó un schema replay, no revirtió esos resultados ni sustituyó la prueba de restore. Ninguna prueba escribió sobre DEV principal. El dictamen `NOT READY` de este archivo sigue siendo el dictamen de latencia/concurrencia de Sprint 12.2 y queda supersedido por el gate Sprint 12.3, doc 124.

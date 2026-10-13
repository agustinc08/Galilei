# Sprint 12.1 — Cierre de bloqueantes técnicos

**Fecha:** 2026-10-08 · **Resultado:** `TECHNICAL PREPRODUCTION — NOT READY`.

## Resumen de ejecución

- DEV confirmado en `127.0.0.1:55432`, PostgreSQL 16.15, rol `bjc_dev`, `pg_trgm 1.6`; 17 migraciones y status limpio; sin privilegio CREATEDB.
- Causa Search detallada en doc 99. Se eliminaron el COUNT legado redundante para texto y dos índices experimentales no seleccionados/beneficiosos. Ninguna estrategia probada llevó TERM común/raro o PHRASE bajo 1 s.
- Benchmark comparable antes/después: docs 100–101; paridad exacta 40/40. Corpus mantiene 5–10 fallas por timeout en casos comunes/booleanos.
- Concurrencia: ola 10 Search p95 45,57 s y 106 errores de fuente; ola 20 Search p95 47,49 s, máximo 284,33 s y 224 errores de fuente. Pools presentaron espera y Node warning bajo carga (doc 102).
- Backup dual SHA válido, incluido backup final posterior a las validaciones (doc 103). Restore real PASS: ocho conteos iguales, 20 hashes deterministas coincidentes, 17 migraciones y Search smoke. Migration-from-zero PASS: DB vacía confirmada, 17 migraciones, 41 tablas, fixture/Search y cleanup PASS (doc 104). Ambas DB temporales fueron eliminadas.
- Backend suite completa 19 suites/79 tests PASS; adapter PostgreSQL 7/7, corpus 3/3, package 2/2, curation 1/1. Typecheck/build backend PASS. Frontend typecheck/build PASS y Playwright 4/4.

## Bloqueantes restantes

1. Rediseñar la generación de candidatos e hidratación de Search preservando los IDs/ranking compatibles; la consulta Prisma relacional y la relectura de texto Corpus son los costos dominantes.
2. Repetir benchmark y olas de concurrencia tras esa implementación; no elevar timeout para convertir cancelaciones en éxitos.

No declarar READY WITH ADJUSTMENTS: los bloqueos afectan búsquedas comunes y la operación con 10 usuarios, además de recuperación no demostrada.

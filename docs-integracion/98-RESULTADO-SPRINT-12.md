# Resultado Sprint 12 — Preproduction Gate

**Dictamen: TECHNICAL PREPRODUCTION — NOT READY.** Search sigue lento y la carga concurrente degrada búsquedas, dashboard, detalle y archivos. Backup validado como archivo; restore y migración desde cero permanecen bloqueados por App Control y privilegios del rol DEV. UAT, ACL institucional y metadata Digesto son pendientes humanos/institucionales separados.

## Trabajo completado

- Medición por 15 familias con warmup y diez repeticiones; COUNT/PAGE y planes EXPLAIN ANALYZE separados para Corpus.
- Cambios acotados en filtro federado Digesto, página Corpus limitada antes del enriquecimiento y logging lento saneado.
- Pruebas de filtros SQL y del contrato del controller; suite general final 18 suites, 76 tests PASS, 15 opt-in omitidos.
- PostgreSQL schema verificado: PostgreSQL 16.15, loopback/rol/base exactos, `pg_trgm 1.6`, 41 tablas y 14 migraciones actuales.
- Backup nuevo con SHA-256; restore aislado intentado desde rutas legítimas, sin eludir App Control.
- Viewer, auth, hardening, OCR y E2E revisados con evidencia S11/S12; no se amplió OCR sin ground truth aprobado.

## No cerrado

Benchmark de paridad 40/40 sólo histórico de Sprint 5.3 (2026-10-07); repetición de Sprint 12 expiró y no escribió artefacto. Restore, migración vacía, muestra OCR 30–50 páginas y UAT no completados. No declarar mejora general de Search: sólo colección redujo su p50 de 6,84 a 5,01 s.

## Sprint 12.1 — exclusivamente bloqueantes técnicos

1. Reducir el costo de count/findMany del camino legacy y verificar 40/40 paridad, más familias Search y filtros topic/tag con datos DEV aprobados.
2. Reducir candidatos para frase y NOT en Corpus y repetir EXPLAIN/benchmark sin cambiar semántica.
3. Aislar dashboard/connection-pool y resolver degradación bajo 5/10/20 usuarios.
4. Solicitar capacidad local autorizada para ejecutar `pg_restore` y crear una DB temporal con privilegios mínimos; probar restore/migraciones/seed y limpiar sólo DBs temporales.

Mientras tanto, mantener DEV local acompañado y no exponerlo a usuarios por red compartida.

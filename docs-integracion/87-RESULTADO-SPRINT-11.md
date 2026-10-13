# Resultado Sprint 11 — UAT y gates preproducción

**Dictamen técnico: NOT READY FOR PREPRODUCTION.** Las pruebas automáticas de DEV pasan, pero la carga de búsqueda se degrada severamente, el restore/migración desde cero no pudo verificarse y la aceptación UAT humana sigue pendiente. No es una autorización para producción ni para red compartida.

## Estado de gates

| Gate | Estado al cierre |
|---|---|
| UAT con Secretaría/Jurisprudencia, Digesto, Consulta y Administración | PENDING HUMAN ACCEPTANCE; checklist en 79 |
| Export Digesto local y crosswalk aprobado | No se halló export local autorizado; especificación lista en 80 |
| Matriz ACL firmada por responsables | PENDIENTE HUMANO |
| Búsqueda end-to-end y profiling por adapters | FAIL preproducción: handler p50 6,8–13,8 s; búsqueda federada p95 llega al timeout 5 s en filtro/frase |
| OCR de páginas atípicas, sin ampliar lote | Dos páginas: PSM 4 a 300 dpi CER/WER 4,80/6,44% y 5,09/4,57%; requiere validación humana, fuente intacta |
| Hardening, sesiones, rate limit y errores seguros | PASS técnico: JWT expiry/rol/inactividad; limitador configurable; 5 suites unitarias relevantes pasan |
| Tablero, queries y N+1 | REVISADO: 5 requests UI, 18 agregaciones paralelas por resumen, no N+1 por fila; dashboard p95 bajo 10 usuarios 37,4 s |
| Visor PDF grande / rangos | PASS rango: PDFs 1/50/109 páginas devuelven 206; 93 archivos ≥50, 4 ≥100, máximo 167 páginas/11,35 MiB; servidor aún bufferiza archivo completo |
| Undo auditado y operaciones de lote | PASS E2E: preview/alta membership, batch a revisión y reversión de clasificación a SUGGESTED con auditoría |
| Concurrencia 5/10/20 en DEV | FAIL para compartir: búsqueda p95 7,1/37,1/65,7 s; 0 errores HTTP en handler local |
| Backup, restore temporal y migración desde cero | Dump 222.191.432 bytes + SHA PASS; `pg_restore` bloqueado por App Control; `bjc_dev` no puede crear DB temporal |
| Build backend/frontend y suites requeridas | PASS: Prisma generate; backend 16 suites/70 PASS (5 suites/15 tests opt-in omitidos); PostgreSQL E2E 2/2; Playwright 4/4; Nest y Next build/typecheck PASS |
| Preparación de demo | PASS de solo lectura: seis cuentas DEV, documento real de Digesto y clasificación sugerida disponibles; sin cambios de registros fuente. No había documento Jurisprudencia en cola `REVIEW_PENDING` para esa muestra. |

## Criterio de cambio de dictamen

`READY FOR PILOT` sólo con ajustes si los gates técnicos quedan resueltos y la UAT reconoce incidencias y responsables. `READY FOR PREPRODUCTION` requiere además aceptación de ACL, recuperación probada en entorno aislado, capacidad y seguridad verificadas con configuración equivalente al destino, y un canal autorizado para el paquete Digesto. La ausencia de aceptación humana no se reemplaza con pruebas automatizadas.

## UAT y feedback

LECTOR, REVISOR, JURISPRUDENCIA, DIGESTO y ADMIN: **PENDING HUMAN ACCEPTANCE**; la matriz imprimible está en 79. No hay incidencias humanas registradas. En validación técnica se encontraron y corrigieron: **P1**, URL de API local apuntaba al frontend y bloqueaba el login browser; **P3**, encabezado CSV sin el mismo quoting que las celdas. No se registran P0 técnicos abiertos. No atribuir estos hallazgos a usuarios.

## Hallazgos y evidencia

Artefactos operativos: `_recovery-work/sprint11/performance/` (perfil Search, concurrencia y planes estimados), `_recovery-work/sprint11/ocr/targeted-outlier-evaluation.json`, `_recovery-work/sprint11/backups/` (dump restringido) y capturas Playwright sólo de fallos previos. Los EXPLAIN ANALYZE representativos y benchmark legado se cancelaron por timeout; planes estáticos disponibles, sin índice agregado. Human UAT y revisión visual OCR no ejecutadas. E2E detectó y corrigió `NEXT_PUBLIC_API_URL` en `.env.local` (apuntaba al frontend); build y Playwright posteriores pasan. La prueba de demo es sólo lectura y no encontró documento Jurisprudencia en cola para usar como ejemplo. Mantener búsqueda y piloto acompañados en DEV local solamente; priorizar optimización del camino legacy/federado, consolidación del dashboard, y restauración en un host aprobado que permita `pg_restore` y DB efímera.

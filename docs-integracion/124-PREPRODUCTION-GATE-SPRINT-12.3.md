# 124 — Gate técnico de preproducción Sprint 12.3

**Dictamen:** **READY WITH NON-BLOCKING ADJUSTMENTS** para continuar a validación controlada DEV/UAT; no habilita despliegue ni red compartida.

## Gates

| Gate | Estado | Evidencia |
|---|---|---|
| Endpoint avanzado usa V2 para familias cubiertas | PASS | 15 familias, ambos adapters V2 salvo filtro Corpus-only; `legacyMs=0`; Playwright de búsqueda normal |
| Paridad Jurisprudencia | PASS | 40/40, cero diferencias de IDs/orden |
| PHRASE/PREFIX/SUFFIX/SHORT | PASS con margen de optimización | Funcionales, cero errores; p95 1.459/577/1.169/1.899 ms |
| ZERO | PASS | p50 15,8 ms / p95 18,5 ms |
| Concurrencia 10 usuarios | PASS con ajuste | Search p95 2,62 s, 0 HTTP/source errors |
| Concurrencia 20 usuarios | PASS con límite operativo | Search p95 4,28 s, 0 errores; pool Prisma waiting peak 123 |
| Migraciones/schema | PASS | 20/20, status limpio, 44 tablas, `pg_trgm 1.6` |
| Corpus projection verify | PASS | 11.008 docs, 9.475.712 tokens, 0 stale, sample 100/100 |
| Backend | PASS | Full 86 PASS; opt-ins 15 omitidos en suite común; Postgres 7/7, Corpus 3/3, package 2/2 dirigidos |
| Frontend | PASS | Typecheck y Next production build |
| Playwright | PASS | 5/5; búsqueda normal, colección Digesto, visor/highlight, dashboard y navegación de roles |
| Backup final | PASS | Dump custom + SQL UTF-8 y SHA en doc 123 |
| Restore y migración desde cero | PASS histórico | Evidencia real de Sprint 12.1 en docs 103/104; replay aislado adicional en 12.2 |
| Aceptación institucional | PENDING | Requiere usuarios/ACL/metadata autorizados |

## Ajustes y límites

El pool Corpus se elevó de 3 a 8 tras errores de fuente bajo saturación; la matriz final mostró cero errores y cero espera Corpus. A 20 usuarios persiste cola en el pool Prisma, por lo que la carga de 20 no representa capacidad para red compartida. FIELD p95 fue 2,115 s y SHORT tuvo una observación alta en la comparación pareada; la repetición del benchmark completo quedó bajo 2 s. Son mediciones locales de desarrollo, no SLO.

HUMAN ACCEPTANCE sigue **PENDING**. ACL institucional y export/crosswalk Digesto **PENDING**. Automatización de CIJ/CSJN **NO GO**. El estado no aprueba publicación, usuarios externos, TLS/proxy, capacidad institucional ni producción.

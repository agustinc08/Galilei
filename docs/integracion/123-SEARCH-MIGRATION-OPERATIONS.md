# 123 — Operación y recuperación del Search read model

## Destino y guard

Toda operación PostgreSQL de este runbook se ejecuta desde `server` con `node scripts/with-dev-db-guard.cjs <acción>`. El guard exige host `127.0.0.1`, puerto `55432`, DB `buscador_juridico_civil_dev` y rol `bjc_dev`. No usar producción, servidor institucional ni DB remota.

## Estado Sprint 12.3

- Prisma: 20/20 migraciones; `prisma migrate status` limpio; schema verify 44 tablas y `pg_trgm 1.6`.
- No se creó migración Sprint 12.3.
- Corpus projection: ready, 11.008 documentos, 9.475.712 tokens, 0 stale, 100/100 de muestra; verify no reconstruyó documentos.
- Los tokens son read model derivado, no fuente de verdad. La tabla se sincroniza transaccionalmente desde `CorpusDocument.searchText`; no hacer rebuild al startup.

## Acciones existentes

Usar las acciones `sprint122-search-projection-rebuild`, `...-verify` y `...-repair`, protegidas por el mismo guard. `verify` es lectura/diagnóstico. `repair` corrige únicamente divergencias encontradas y `rebuild` reconstruye el read model; antes de cambios operativos, revisar destino y obtener backup DEV. No ejecutar rebuild como tarea de rutina: es innecesario si readiness/verify ya están sanos.

Después de actualizar `CorpusDocument.searchText`, el trigger SQL actualiza los tokens en la misma escritura. Si readiness es falso, Search conserva el fallback de texto exacto; verificar antes de activar de nuevo la proyección. No hay build/verify/repair separado para Jurisprudencia porque no se implementó su proyección física (doc 118).

## Migración, restore y DB vacía

Sprint 12.3 no añade migraciones. El status final quedó limpio. Las pruebas de Sprint 12.1 continúan vigentes: doc 103 registra restore real de backup hacia una DB temporal vía `psql` 16.15, conteos y 20 hashes; doc 104 registra 17/17 migraciones desde una DB temporal vacía y limpieza. Sprint 12.2 añadió schema replay aislado de 20 migraciones, evidencia adicional. Son tres pruebas separadas; ninguna restauración se hizo sobre DEV principal.

## Backup final

Backup dual en `_recovery-work/sprint123/backups/`, manifiesto `manifest-final.json`. Dump custom 292.430.265 bytes, SHA-256 `77a7c4888a5e60e87238f86417908e6cc69d3a13d926ca2a2bcf364c55ad8c19`; plain SQL UTF-8 1.207.928.742 bytes, SHA-256 `08635236a69ded5b1541e9a02805217320b62cb1222f25762e67c1d2131fbf32`. Contraseña no persistida en el reporte.

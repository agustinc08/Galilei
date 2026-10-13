# Backup y restore — validación Sprint 12

## Backup

- Archivo: `_recovery-work/sprint12/backups/buscador_juridico_civil_dev-pre-sprint12-2026-10-08T06-45-59-879Z.dump`
- Tamaño: 222.192.378 bytes
- SHA-256: `416fee1bfc789ca79068d81cd8c5fcfc543fdf4cc10b7eefb799b0190aae1492`
- `pg_dump`: PostgreSQL 16.15
- Hash recalculado y coincidente.

## Restore aislado

**BLOQUEADO, no validado.** `pg_restore --list` fue bloqueado por Windows Device Guard/App Control desde la ruta oficial de PostgreSQL, PowerShell y `cmd`; intento `child_process` también falló. No se intentó evadir el control. El rol `bjc_dev` no tiene `CREATEDB`, por lo que no existe DB temporal autorizada disponible.

No se restauró sobre la DB principal. Sin restore temporal no hay comparación de tablas/conteos, hashes de archivo ni smoke de búsqueda en instancia restaurada. Evidencia de intento en `_recovery-work/sprint12/backups/verification.json`.

El dump de PostgreSQL no contiene necesariamente los PDFs en storage externo. El runbook exige copia coherente de storage content-addressed, manifiesto y verificación de checksums junto con la DB. Este gate impide READY técnico.

# Backup, restore y migración desde cero — Sprint 11

**Estado: dump creado y SHA-256 verificado; restore temporal y migración vacía BLOQUEADOS por permisos/política del equipo.** Ninguna restauración debe sobrescribir `buscador_juridico_civil_dev`.

Procedimiento DEV: verificar con el guard `127.0.0.1:55432/buscador_juridico_civil_dev` y rol `bjc_dev`; crear dump con timestamp y hash bajo `_recovery-work/sprint11/backups`; listar el archivo y comprobar hash; restaurar exclusivamente en una base temporal con nombre `bjc_sprint11_restore_verify_*`; verificar migraciones, conteos agregados y readiness; eliminar sólo la base temporal después de documentar la evidencia. Mantener el dump fuera del repositorio y restringido.

Para migraciones desde cero, aplicar `prisma migrate deploy` a otra base temporal vacía y ejecutar verificación de schema/integridad. Si el rol DEV no puede crear bases, dejar el caso como bloqueado por privilegio y solicitar una vía aislada aprobada; no usar el DB principal como scratch ni elevar privilegios silenciosamente.

| Control | Resultado | Evidencia |
|---|---|---|
| Target DEV validado antes de dump | PASS | Guard `institutional-backup` |
| SHA-256 del dump | PASS | `6c8a1bac…25590db8`, 222.191.432 bytes, cabecera `PGDMP` |
| Lectura/listado del archive | BLOQUEADO | Windows App Control bloquea `pg_restore.exe` |
| Restore en base temporal | BLOQUEADO | No se pudo verificar el archivo ni crear DB temporal |
| 14 migraciones desde DB vacía | BLOQUEADO | `bjc_dev.rolcreatedb=false`; sin DB temporal |
| Schema/readiness después del restore | Pendiente | |

Evidencia: dump custom bajo `_recovery-work/sprint11/backups/`; SHA-256 completo `6c8a1bacd1bece76241b8fa504d20be02c1207114438d8b0913dbcec25590db8`. El target se validó por guard y `pg_dump`. No se pudo ejecutar `pg_restore --list`: Windows App Control bloqueó el binario (`spawn UNKNOWN` vía Node y bloqueo de ejecución desde PowerShell). El rol no puede crear bases temporales. Prisma informa 14 migraciones aplicadas y estado al día. No se intentó restaurar sobre la DB principal.

# Migraciones desde cero — Sprint 12

**Estado: BLOQUEADO por privilegio externo.** La DEV autorizada es `bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev`; preflight confirmó PostgreSQL 16.15 y `rolcreatedb=false`. No se creó una base efímera porque no hay privilegio CREATEDB. No se aplicaron migraciones sobre la DB principal para simular un schema vacío.

La DB DEV actual está al día: **14 migraciones aplicadas**, `prisma migrate status` limpio y verificación de schema PASS (41 tablas; `pg_trgm` 1.6). Esto demuestra estado actual, no que las 14 migraciones levanten correctamente desde vacío ni que seed/init funcione sin estado previo.

La secuencia pendiente en un entorno local aislado con privilegio mínimo es crear `buscador_juridico_civil_migration_test`, ejecutar `prisma migrate deploy`, verificar schema/índices/extensiones y ejecutar seed mínimo; registrar resultado y eliminar sólo esa DB temporal. No requiere corpus completo. No usar servidores remotos.

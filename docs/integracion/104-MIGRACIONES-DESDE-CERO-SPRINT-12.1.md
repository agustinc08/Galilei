# 104 — Migraciones desde base vacía (Sprint 12.1)

DEV principal verificado: 17/17 migraciones aplicadas, `pg_trgm 1.6`, `migrate status` limpio. Prisma Client v7.8.0 generó correctamente.

La DB `buscador_juridico_civil_migration_test` empezó realmente vacía: cero tablas públicas y sin historial Prisma. `prisma migrate deploy` aplicó las 17 migraciones sin error; quedó con 41 tablas públicas, 17/17 migraciones, `pg_trgm 1.6`, sin índices experimentales descartados. El fixture Corpus sintético se encontró con `CorpusSearchSourceAdapter` y fue eliminado; el conteo final fue cero documentos. Para esta prueba, el guard activa `BJC_SPRINT121_TEMP_DB_TEST=1` y el adaptador acepta sólo la DB de migración con nombre exacto; por defecto continúa admitiendo exclusivamente DEV principal. Resultado: PASS. Artifact: `_recovery-work/sprint121/performance/migration-from-zero.json`.

Se dejó implementada la secuencia protegida `migration-deploy → migration-fixture → migration-verify` en `scripts/dev/sprint121-migration-*.ts`, bajo el guard `scripts/with-sprint121-temp-db-guard.cjs`, que sólo admite esa base temporal exacta. El fixture es sintético y se elimina al terminar. El historial contiene create/drop de los dos índices experimentales descartados; el verificador comprueba que el schema final no los tenga.

El rol `bjc_dev` permanece sin CREATEDB permanente. Tras verificar el restore y migration-from-zero, el guard eliminó ambas bases temporales por nombre exacto. No se apuntó ninguna acción a producción.

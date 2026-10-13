# 103 — Backup y restore real (Sprint 12.1)

## Backup

Backup dual creado desde DEV verificado (`bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev`):

- Custom: `_recovery-work/sprint121/backups/buscador_juridico_civil_dev-sprint121-2026-10-08T15-07-23-634Z.dump`, 222.192.755 bytes, SHA-256 `fd83f35dad53c6239874299b844bb7ba8bcb9f1c1934faf003aa145b4b9fe071`.
- Plain UTF-8: `_recovery-work/sprint121/backups/buscador_juridico_civil_dev-sprint121-2026-10-08T15-07-23-634Z.sql`, 806.208.855 bytes, SHA-256 `e34b80ee55bf79d36a16a9bf43b7dd7dcba5909ded8bbf8a1e9da07610ac76a2`.
- Manifiesto y hashes: `_recovery-work/sprint121/backups/manifest.json`.
- Backup final tras validaciones Sprint 12.1: custom `_recovery-work/sprint121/backups/buscador_juridico_civil_dev-sprint121-2026-10-08T16-04-13-016Z.dump`, 222.192.755 bytes, SHA-256 `47a44b956f6fdeaa40965f68e78e36da77e2235262fa1a4bb4854587dfd0340f`; plain UTF-8 `.sql`, 806.208.855 bytes, SHA-256 `3229fc8087a1a0cf3ed08616019c599858f1e86f41aa59a3a36463ec15ace22b`. Ningún backup anterior se eliminó.

## Restore

**PASS.** `pg_restore.exe` quedó bloqueado por la política Windows App Control, documentada en Sprint 12. Se usó la alternativa oficial `psql` 16.15 sobre el SQL UTF-8, con hash revalidado, `ON_ERROR_STOP=1`, `--single-transaction` y destino exclusivo `buscador_juridico_civil_restore_test`.

La verificación comparó ocho tablas disponibles: CorpusDocument 11.008; CorpusDocumentFile 11.028; CorpusDocumentPage 96.375; CorpusExtraction 11.030; CorpusDocumentClassification 21.547; DigestoCollection 1; DigestoCollectionMembership 276; Usuario 7. Todos los conteos coinciden. La muestra determinista de 20 hashes coincide; el reporte no conserva hashes crudos. Restauración: 17/17 migraciones, `pg_trgm 1.6` y una consulta SQL con el predicado de búsqueda que encontró 4.281 candidatos. La prueba del adaptador Search en código se hizo con el fixture desde cero (doc 104); no se afirma una prueba de UI/API sobre la DB restaurada.

Los guards verificaron la evidencia y eliminaron únicamente las dos DB de prueba: `buscador_juridico_civil_restore_test` y `buscador_juridico_civil_migration_test`. Cleanup PASS; la base DEV principal no fue destino. Resultado completo: `_recovery-work/sprint121/backups/restore-result.json` y `restore-verification.json`.

Mantener ambos backups; no eliminar backups previos.

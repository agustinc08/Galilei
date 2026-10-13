# Fixture DEV SQLite → PostgreSQL

**Misión:** 5.3 · **Estado:** IMPLEMENTADO y verificado · **Fecha:** 2026-10-07

## Origen y regla reproducible

- Fuente: `C:\proyecto triple\_legacy-audit-work\extracted\jurisprudencia\jurisp_6\db\jurisprudencia_db.sqlite`.
- Lectura SQLite con `mode=ro&immutable=1`, `OPEN_READONLY` y `PRAGMA query_only=ON`.
- Selección: todas las filas ordenadas por ID de `tb_sentencias`; todos los `tb_sumarios` unidos a una sentencia existente, también ordenados por ID.
- No se consultan ni importan `tb_microisis` o `tb_operadores`.
- Conteos: 21.109 sentencias; 25.139 sumarios fuente; 1 sumario huérfano excluido por integridad referencial; 25.138 sumarios cargados.
- IDs numéricos preservados en PostgreSQL. `legacyId` registra archivo, tabla e ID. Las marcas `createdAt`/`updatedAt` usan el instante fijo de fixture `2000-01-01T00:00:00Z` porque la fuente no trae esos campos.
- Sentencias importadas con `publicado=false`; la carga de fixture no constituye publicación editorial.

## Carga y verificación

Herramienta: `JurisprudenciaN/back/scripts/dev/import-search-fixture.ts`. Ejecuta una transacción, hace upsert por `legacyId`, fija las secuencias y revierte íntegramente ante error. La ejecución repetida conservó 21.109/25.138 filas sin duplicación.

Resultado de la última importación: `FIXTURE_IMPORT=PASS`; checksum determinista de filas normalizadas: `4f1ff99a99caaf32efd2bebe361a61245d88a4bc8ffb90067599bd1937c475d1`.

Destino obligatorio: `bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev`. `scripts/with-dev-db-guard.cjs` valida la URL antes de importar y el importador vuelve a verificar la identidad de la conexión dentro de PostgreSQL.

## Evidencia

- Conteos, tablas, migraciones y extensión: `BJC-ESTADO-ACTUAL.md`.
- Paridad por ID y tiempos: `29-benchmark-postgresql.json`.
- Importador: `JurisprudenciaN/back/scripts/dev/import-search-fixture.ts`.

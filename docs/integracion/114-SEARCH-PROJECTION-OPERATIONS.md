# Search Projection Operations — Sprint 12.2

**Fecha:** 2026-10-08 · **Alcance:** PostgreSQL DEV local únicamente.

## Preflight

Desde `server`, confirmar `127.0.0.1:55432`, DB `buscador_juridico_civil_dev`, rol `bjc_dev` con `node scripts/with-dev-db-guard.cjs prisma-migrate-status`. No leer ni copiar `.env.development.local`.

## Prisma y schema

```powershell
node scripts/with-dev-db-guard.cjs prisma-generate
node scripts/with-dev-db-guard.cjs prisma-migrate-status
```

Antes de una migración Search, crear backup DEV y verificar sus dos SHA con el manifest Sprint 12.2. Aplicar únicamente con `prisma-migrate-deploy` bajo el guard. Después repetir migration-schema smoke; ese smoke reejecuta todas las migraciones en un schema aislado dentro de la DB DEV y no equivale a crear una DB vacía.

## Projection

```powershell
pnpm run search:rebuild
pnpm run search:verify
pnpm run search:repair
```

- `rebuild` rellena documentos faltantes o stale; vuelve a verificar y cambia readiness sólo al pasar.
- `verify` desactiva readiness durante la revisión; comprueba checksums/recuentos completos y muestra exacta determinista de 100 documentos. Al finalizar, deja readiness en PASS o fallback.
- `repair` desactiva readiness y reconstruye todos los documentos por lotes, luego valida.

Los tres comandos son reentrantes y guardados. No reconstruir en el arranque del servicio. Revisar `_recovery-work/sprint122/projection/projection-status.json` sin compartir tokens o texto fuente.

## Reindex y evidencia

```powershell
pnpm run search:reindex
node scripts/with-dev-db-guard.cjs sprint122-explain
node scripts/with-dev-db-guard.cjs sprint122-corpus-benchmark
```

`search:reindex` ejecuta `REINDEX INDEX CONCURRENTLY` sólo sobre `CorpusSearchToken_token_trgm_idx`; usarlo si la evidencia de tamaño/plan muestra bloat o pérdida de uso. No ejecutar como ritual después de cada rebuild. Registrar plan, buffers, p50/p95 y tamaño antes/después.

## Pruebas de gate

```powershell
pnpm exec jest src/corpus/corpus-search.adapter.spec.ts --runInBand
node scripts/with-dev-db-guard.cjs sprint122-migration-schema
node scripts/with-dev-db-guard.cjs sprint122-parity
```

El primer comando es unitario. El segundo crea y elimina un schema de prueba dentro de DEV, confirma triggers y búsquedas de fixture; los comandos guardados no aceptan endpoints alternativos.

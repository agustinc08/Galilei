# Search Projection — Corpus — Sprint 12.2

**Fecha:** 2026-10-08 · **Estado:** IMPLEMENTADA y verificada en DEV; 11.008 documentos y 9.475.712 tokens; doc 116.

## Read model

`CorpusSearchToken(documentId, token)` guarda una vez cada token distinto por documento. `token` procede de `CorpusDocument.searchText`, que el pipeline existente normaliza al escribir. El índice GIN `gin_trgm_ops` acelera subcadenas dentro de tokens. `CorpusSearchTokenState` guarda MD5 del texto de origen, cantidad de tokens y fecha de actualización.

`CorpusSearchTokenProjectionControl` tiene un único registro readiness. El adapter usa tokens sólo con `isReady=true`. Mientras falta la tabla, `isReady=false` o la validación falla, usa la consulta exacta anterior; así no responde desde un backfill parcial.

## Actualización

La migración `20261008210000_corpus_search_token_projection` crea las tablas, índice y función `refreshCorpusSearchTokens`. El trigger `CorpusDocument_sync_search_tokens` actualiza la proyección dentro de la transacción que inserta o cambia `searchText`. La migración `20261008220000_corpus_search_projection_readiness` agrega el control, inicializado no listo.

No se reconstruye al iniciar la aplicación. El backfill opera en lotes de 50 y selecciona documentos faltantes o cuyo checksum/recuento diverge. La reparación recorre todos los documentos en lotes.

## Operación

Desde `server`, siempre usar el guard DEV:

```powershell
pnpm run search:rebuild
pnpm run search:verify
pnpm run search:repair
```

`verify` compara checksums y recuentos de todos los documentos, comprueba exactamente hasta 100 documentos de muestra y sólo entonces marca la proyección lista. Si no pasa, la búsqueda vuelve al fallback exacto. `repair` desactiva readiness, refresca todo y vuelve a verificar.

El JSON operacional se guarda en `_recovery-work/sprint122/projection/projection-status.json`; incluye host/database/role, conteos, muestra, tamaño DB/índice y readiness. Nunca guarda `searchText` ni contraseñas.

## Consistencia

- INSERT/UPDATE de `searchText`: trigger transaccional reemplaza tokens y actualiza checksum/recuento.
- DELETE de documento: FK elimina tokens y estado.
- Rebuild: idempotente; omite documentos verificados.
- Repair: reconstrucción completa, limitada al corpus DEV.
- Restore real y ejecución contra una DB vacía tienen gates separados; la replay en schema DEV no se etiqueta como restauración o creación de DB temporal.

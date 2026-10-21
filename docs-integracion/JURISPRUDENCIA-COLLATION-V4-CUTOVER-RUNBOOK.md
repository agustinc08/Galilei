# Jurisprudencia Collation V4 — candidate cutover runbook

## Current candidate state

This branch is based on `origin/dev` SHA `043c7b1d327aaf903bc321eb376395b2a3c8d8a7`. It prepares a later, separately reviewed DEV cutover. It does not move the alias, update `dev`, or change the default Search target.

- `galilei-search-active` remains attached only to `galilei-search-v003-20261017t232432555z-a6af18cb`.
- The V4 shadow is `galilei-search-v004-20261020t094732495z-6015e394`.
- Normal application configuration remains schema 3 and writes through the active alias.
- Schema 4 physical writes require `OPENSEARCH_TRUSTED_PHYSICAL_WRITE=true`, an explicit generated V4 index name, local development mode, and `OPENSEARCH_READ_ONLY_CANDIDATE=false`. The operator target is not accepted from an HTTP request.
- `search:v4:operator replay` is the guarded operator callsite. `--dry-run` performs no OpenSearch writes; `--apply` writes only to the validated physical index and never changes the alias or outbox history.
- Every replay requires `--expected-alias-target v3` or `v4`. Before dry-run or apply, the CLI verifies the exact DEV database identity, target naming and mapping schema, exact OpenSearch build, green health, ICU version, 2 GiB heap, and the single active alias target. A failed check prevents projection.
- `cutover --preflight` and `rollback --preflight` print the exact atomic alias plan and checks. This candidate intentionally rejects alias-changing `--apply`; the real alias cutover is a later reviewed operation.

## Writer and projector lifecycle

The OpenSearch outbox worker runs inside the Nest backend. `OpenSearchRuntimeService.onModuleDestroy()` calls `OpenSearchSyncWorker.stop()`, which clears its timer and waits for an in-flight batch. There is no independent pause API. Therefore a maintenance window must stop every backend instance gracefully and verify all mutation entry points are no longer listening before capturing the final boundary. Do not force-kill a process or leave another application replica serving writes.

After the alias transition, restart the backend with schema 4, the exact V4 physical target, and trusted physical writer mode. Runtime readiness requires the alias to point to that same physical target; this prevents the schema 4 worker from starting while V3 is still active.

## High-water and catch-up

`SearchIndexOutbox.id` is a monotonic `BIGINT` identity and is the boundary, not a timestamp. Record `H0` before the V4 shadow interval. Final replay takes the blocking Search advisory lock, opens a PostgreSQL transaction, and obtains `SHARE` locks on every outbox-trigger source table plus `SearchIndexOutbox`. It captures `H_CUT = MAX(SearchIndexOutbox.id)` while those locks are held.

For `H0 < id <= H_CUT`, replay reads the latest event per `documentKey` in stable keyset pages of 250. For each key it resolves the current PostgreSQL source state and applies the existing schema-specific projection to the exact physical target. It refreshes the target, verifies exact ID parity, and reports pending/failed outbox rows through `H_CUT`. The barrier remains held through those checks. Outbox event rows are not deleted or rewritten by replay.

The maintenance sequence closes the post-catch-up race by keeping all application mutation entry points and the in-process projector stopped from before the final replay until after the atomic alias operation and V4 backend restart. PostgreSQL locks also prevent source/outbox writes during replay itself. The operator preflight's `BJC_SEARCH_MAINTENANCE_QUIESCED=true` is an operator attestation; it does not discover or stop backend processes automatically.

## Future V3 to V4 maintenance sequence

1. Confirm the principal DEV DB identity and OpenSearch runtime with the guarded checks. Confirm V3 and V4 parity and outbox pending/failed counts are zero.
2. Gracefully stop every DEV backend instance. Verify the serving mutation listeners/processes are gone; module shutdown must finish the worker's in-flight batch.
3. Capture or confirm `H0`; run the V4 replay dry-run, then the explicit physical replay apply to V4. The apply captures and reports `H_CUT` under the DB barrier.
4. Run cutover preflight with the maintenance attestation set. Require exact DB/search identity, green health, the certified ICU build and heap, clean outbox through the boundary, both physical indices, target parity, and a valid V4 writer configuration.
5. In the later approved cutover, issue one atomic alias update removing V3 and adding V4 as write index. Keep the backend stopped until the alias is verified.
6. Start the backend with schema 4 and the trusted physical V4 target. Verify runtime readiness and the worker target, then resume normal traffic.

Before the alias operation, any failure leaves V3 active and the application can be restarted in its original schema 3/alias configuration. Do not delete V3 during the validation or rollback period.

## Future rollback after V4 has served writes

Keep the backend stopped and the V4 projector drained. Capture a new rollback `H0` only after quiescing. Replay the current PostgreSQL state and all outbox keys through the captured high-water into the retained physical V3 index using schema 3. Require exact ID parity and zero pending/failed events through the boundary. Then, in one atomic alias update, remove the alias from V4 and add it to V3. Restart the backend with its default schema 3/alias configuration. Do not infer freshness from timestamps or replay “until it looks current.”

## Safe OpenSearch runtime

Use the tracked `scripts/dev/opensearch-local.ps1` with `OPENSEARCH_HOME`, `OPENSEARCH_PATH_CONF`, and `BJC_OPENSEARCH_DATA_PATH` supplied by the operator. Invoke it with Windows PowerShell 5.1. The launcher requires the existing data path, exact OpenSearch 2.19.6 runtime, `analysis-icu` 2.19.6 with ICU4J 75.1, exactly `-Xms2g -Xmx2g`, and no competing OpenSearch process. Start/status readiness verifies runtime home/config/data path, green health, V3 and V4 identity/counts, and the active alias target. The default expected target is V3; after a certified cutover, set `BJC_OPENSEARCH_EXPECTED_ACTIVE_TARGET` to the exact V4 name for the post-cutover restart. Any other target is rejected. A missing plugin or 1 GiB heap fails before start.

Perform a restart as separate `stop`, process/port verification, `start`, and `status` invocations. Windows console-control delivery can interrupt the PowerShell host after the graceful stop, so the `stop` invocation may return without its final output or with a nonzero shell exit even though OpenSearch shut down. Do not infer success from that exit alone: require that no OpenSearch Java process and no listener on ports 9200/9300 remain before starting. If either remains, abort. The launcher deliberately exposes no combined `restart` action.

All commands that can connect to PostgreSQL DEV must go through `scripts/with-dev-db-guard.cjs`. The guard requires `bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev`. Never run migrations as part of this cutover candidate.

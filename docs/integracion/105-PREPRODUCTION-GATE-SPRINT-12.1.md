# 105 — Gate técnico de preproducción (Sprint 12.1)

**Dictamen:** `TECHNICAL PREPRODUCTION — NOT READY`.

| Criterio | Estado | Evidencia |
|---|---|---|
| Search con mejora material y latencia aceptable | FAIL | Común p50 6,26 s; frase 7,68 s; boolean complejo 14,77 s; doc 101 |
| Sin timeouts Corpus sistemáticos | FAIL | SQLSTATE 57014 entre 50% y 100% según familia |
| Paridad Search | PASS | 40/40, `_recovery-work/sprint121/parity/benchmark.json` |
| Concurrencia razonable a 10 usuarios | FAIL | Search p95 45,57 s, fuente fallida 106; pool waits; doc 102 |
| Restore real y hash de muestra | PASS | Restore SQL en transacción única; ocho conteos y 20 hashes iguales; Search smoke PASS; doc 103 |
| Migraciones desde DB vacía y smoke | PASS | DB confirmada vacía → 17 migraciones → schema → fixture/search/cleanup; doc 104 |
| Backend | PASS | typecheck/build y suite 19/19, 79 tests; opt-in PostgreSQL/CORPUS incluidos aparte |
| Frontend | PASS | typecheck, production build, Playwright 4/4 |
| DEV migrate status | PASS | 17 migraciones aplicadas y estado actualizado |

Search y concurrencia siguen fallando cuantitativamente, aunque restore y migration-from-zero ahora están demostrados. UAT humana continúa separada como PENDING; ACL approval y export Digesto siguen PENDING; CIJ/CSJN sigue NO GO. Esta decisión sólo evalúa preproducción técnica local.

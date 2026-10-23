# Concurrencia — Sprint 12

**Estado: FAIL técnico.** Corrida read-heavy de handlers HTTP Nest in-process sobre DEV local, sin TLS/proxy. Por usuario: 20 requests, mezcla 60% búsqueda, 15% dashboard, 15% detalle y 10% archivo/matches. Se suprimieron escrituras de eventos de búsqueda y no se guardaron consultas. Artefacto: `_recovery-work/sprint12/performance/concurrency-results.json`.

| Usuarios | Requests | Throughput | Search p50 / p95 / max | Errores Search | Dashboard p95 | RAM Node máx | Conexiones PG máx (activas) |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 20 | 0,25 req/s | 6,84 / 7,01 / 7,01 s | 0 | 192 ms | 715 MiB | 9 (5) |
| 5 | 100 | 0,44 req/s | 14,13 / 36,53 / 54,19 s | 9/60 | 620 ms | 779 MiB | 17 (13) |
| 10 | 200 | 0,49 req/s | 20,77 / 74,01 / 167,44 s | 3/120 | 5,22 s | 789 MiB | 17 (15) |
| 20 | 400 | 0,49 req/s | 42,54 / 82,33 / 563,91 s | 5/240 | 38,19 s | 838 MiB | 17 (15) |

Los errores son requests sin respuesta HTTP completada en el harness. Al llegar a 20 usuarios, p95 de detail fue 43,47 s; Range/file 19,58 s y matches 43,56 s. CPU reportada por proceso Node como porcentaje de un core: 20,2%, 28,4%, 36,1%, 35,5%. Pico de conexiones no llegó al límite observado de 17, lo cual no descarta espera de pool; esta corrida no aisló tiempos de espera de pool frente al costo SQL. Una advertencia MaxListeners del servidor supertest apareció a 20 usuarios y se atribuye al harness in-process.

No es una prueba de capacidad de red ni de producción. Aun como prueba DEV los p95 y errores exceden claramente un gate razonable. No instalar PgBouncer sin instrumentar primero consulta/pool.

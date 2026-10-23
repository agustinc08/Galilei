# Search Concurrency V2 — Sprint 12.2

**Fecha:** 2026-10-08 · **Topología:** handlers Nest en proceso y PostgreSQL DEV local; sin proxy/TLS/red.

## Mix de carga

Cada usuario ejecutó 20 solicitudes secuenciales: 12 búsquedas, 3 resúmenes de dashboard, 3 detalles, 1 rango de archivo y 1 búsqueda de coincidencias. Las olas ejecutaron 1/5/10/20 usuarios; no se cambiaron timeouts ni pool.

| Usuarios | Solicitudes | Duración | Search p50 | Search p95 | Search max | HTTP errors en Search | Source errors | Prisma wait pico | Corpus wait pico |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 20 | 58.8 s | 5.94 s | 6.33 s | 6.33 s | 0 | 0 | 0 | 0 |
| 5 | 100 | 158.1 s | 6.90 s | 24.58 s | 35.14 s | 0 | 0 | 2 | 1 |
| 10 | 200 | 218.8 s | 9.15 s | 35.65 s | 82.27 s | 11 | 0 | 35 | 6 |
| 20 | 400 | 422.1 s | 19.18 s | 35.94 s | 261.45 s | 6 | 0 | 80 | 5 |

Los pools llegaron a 10/10 Prisma y 3/3 Corpus. La DB llegó a 17 conexiones. Aunque el contador `sourceErrors` quedó en cero, 10/20 usuarios tuvieron errores HTTP y latencias extremas: el gate de concurrencia falla.

## Warning de listeners

La corrida inicial mostró `MaxListenersExceededWarning` con stack dentro de `supertest/lib/test.js`: el harness pasaba el mismo servidor no escuchado a cada `request()`, y Supertest añadía listeners `close` por solicitud. No era un listener de producción. Se corrigió el harness para escuchar una vez en loopback y usar URL HTTP local; una prueba simultánea de 20 búsquedas terminó en 9,4 s, HTTP/source errors 0, y sin warning. El pool llegó a 10/10, con 51 esperas durante el pico.

El smoke de 20 solicitudes valida el arreglo del harness, no sustituye la ola completa de 20 usuarios. Artifact completo: `_recovery-work/sprint122/performance/concurrency-results.json`; validación del harness: `concurrency-results-listener-smoke.json`.

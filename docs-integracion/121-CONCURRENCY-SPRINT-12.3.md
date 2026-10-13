# 121 — Concurrencia Sprint 12.3

**Topología:** handlers HTTP Nest in-process sobre DEV local; no incluye TLS, proxy ni red compartida. Cada usuario simulado envía 20 solicitudes con 60% Search, 15% dashboard, 15% detalle y 10% archivo por rango/matches. Se suprimieron escrituras de eventos y no se guardó texto de búsqueda.

| Usuarios | Solicitudes | Duración ola s | Search p50 ms | Search p95 ms | HTTP errors | errores de fuente | Prisma espera pico | Corpus espera pico |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 20 | 2,25 | 128,57 | 259,26 | 0 | 0 | 7 | 0 |
| 5 | 100 | 8,38 | 414,24 | 1.330,87 | 0 | 0 | 11 | 0 |
| 10 | 200 | 22,32 | 1.886,41 | 2.619,28 | 0 | 0 | 11 | 0 |
| 20 | 400 | 47,44 | 3.729,96 | 4.284,08 | 0 | 0 | 123 | 0 |

## Pool y recursos

El pool raw de Corpus pasó de 3 a 8 conexiones máximas después de que la primera medición revelara 47 errores de fuente a 20 usuarios y espera de hasta 16 en Corpus. La repetición de 10/20 con pool 8 redujo errores HTTP/fuente a cero y espera pico Corpus a 0/3; se dejó documentada en `concurrency-results-pool8.json`. La matriz final completa `concurrency-results-pool8full.json` mostró cero espera Corpus en las cuatro olas. Los picos de conexiones PostgreSQL fueron 4, 19, 28 y 29. El pool Prisma de 10 mostró cola de hasta 123 a 20 usuarios; no se aumentó sin probar la capacidad total de DB.

CPU/RSS son del proceso Node del harness; no equivalen a medición de host institucional. No hubo errores HTTP, errores de fuente ni advertencias de listener en la matriz final. A 20 usuarios hay degradación visible de latencia y cola Prisma; requiere observarse nuevamente con topología real antes de compartir el servicio.

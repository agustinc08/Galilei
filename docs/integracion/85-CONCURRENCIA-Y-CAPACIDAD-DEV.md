# Concurrencia y capacidad DEV — Sprint 11

**Estado: EJECUTADA en DEV local; capacidad insuficiente para compartir.** Carga de lectura sobre la población existente mediante el guard. No se conectó a sistemas institucionales.

| Usuarios virtuales | Solicitudes | p50 | p95 | máximo | errores | Estado |
|---:|---:|---:|---:|---:|---:|---|
| 5 | 15 | Búsqueda: 1.573 ms | Búsqueda: 7.061 ms | 7.061 ms | 0 | Completo |
| 10 | 30 | Búsqueda: 21.400 ms | Búsqueda: 37.086 ms | 37.086 ms | 0 | Completo |
| 20 | 60 | Búsqueda: 38.411 ms | Búsqueda: 65.673 ms | 66.774 ms | 0 | Completo |

Resumen por endpoint: readiness p95 1.723/13,84/70 ms para 5/10/20 (pico aislado 67,2 s a 20); resumen dashboard p95 2.397/37.368/6.816 ms (pico 67,1 s a 20); búsqueda p95 7.061/37.086/65.673 ms. Todas las respuestas fueron HTTP 200. Las solicitudes de cada usuario virtual fueron secuenciales por endpoint y concurrentes entre usuarios. La lectura del dashboard originó 18 agregaciones paralelas por request.

Corrida registrada por `scripts/dev/sprint11-concurrency.ts`, 5/10/20 usuarios, tres rutas cada uno, sin respuestas de error. La degradación de búsqueda a 10/20 usuarios es severa y bloquea red compartida/preproducción. La prueba usó handlers Nest en HTTP local en proceso, sin middleware de arranque, TLS, proxy ni prueba prolongada. No interpretar como capacidad de producción. Antes de escalar, reducir el coste legacy y del dashboard y repetir con topología de destino.

# Migración de stack 2026

## Objetivo

Convertir `client/` de Next.js a una SPA React + Vite, mantener `server/` en NestJS + Prisma y unificar instalaciones en un workspace pnpm. La migración se realiza en `refactor/galilei-stack-modernization1`, basada en `749ad15fb429beb652863a51dcb6eb5dd906f841`.

## Resultado de arquitectura

- El cliente arranca desde `client/index.html` y `client/src/main.tsx`; Vite produce `client/dist`.
- React Router resuelve las rutas públicas y autenticadas con fallback SPA.
- El helper tipado de entorno lee variables `VITE_*`; API base y endpoints de build se configuran sin secretos en el bundle.
- No quedan imports funcionales desde `next/*`, `next.config.ts`, dependencia Next ni scripts `next build/start`.
- `server/` conserva NestJS + Prisma; las pruebas y builds generan el cliente Prisma sin conectar a una DB.
- Los scripts TypeScript ejecutados por `ts-node` habilitan `experimentalResolver`: Prisma 7 emite imports `.js` para su cliente generado y el resolver los mapea al código `.ts` al correr desde fuente.
- Un `pnpm-lock.yaml` raíz fija el workspace `client/` + `server/`.

## Paridad y validaciones

- Inventario de rutas: 40 antes y 40 después; cero rutas faltantes o agregadas.
- Toolchain repetido desde el worktree con Node 24.22.1 y pnpm 12.15.0: `typecheck`, `lint`, `test` y `build` pasaron. El backend informó 0 errores y 0 warnings de ESLint; Jest pasó 52 suites y 396 tests, con 1 suite y 10 tests omitidos. El cliente pasó sus 9 pruebas Node.
- UX público en worktree limpio: 63/63 verificaciones del reporter pasaron; Playwright 22/22 y matriz responsive 18/18 en viewports de 390x844 a 2560x1440, sin errores de consola, warnings React, errores de página, fallas de red, misses de fixtures ni overflow horizontal. El inventario de rutas es 40/40. `/galilei`, `/personal` y `/spaces/manage` están registradas como rutas autenticadas; los 8 journeys UI que requieren credenciales siguen diferidos porque no hay credenciales QA configuradas.
- Integración aislada: 7 suites PostgreSQL/11 tests y la suite ACL personal/restringida (1 test) pasaron; el test local de extracción/OCR pasó 6/6. ACL usó PostgreSQL QA en `127.0.0.1:55434` y OpenSearch QA en `127.0.0.1:19200`, nunca el Search principal. La limpieza dejó 0 documentos ni usuarios sintéticos y restauró el backlog PostgreSQL QA al valor de línea base.
- Golden de producto en QA aislada: 325/325 casos de adapter y 325/325 HTTP, 0 falsos positivos/negativos y 0 timeouts; paginación 325/325 sin duplicados, orden estable 4/4. El postcheck dejó 0 `CorpusDocument`, 0 colecciones sintéticas, 0 eventos pendientes/fallidos y 0 documentos en el alias QA.
- Instalación reproducible final: `pnpm install --frozen-lockfile` pasó en un worktree detached nuevo del candidato, inicialmente sin `node_modules` ni cliente Prisma generado; Node 24.22.1 y pnpm 12.15.0. Luego pasaron typecheck, lint, test y build. Jest: 52 suites / 396 tests PASS, 1 suite / 10 tests opt-in omitidos; además, el test de orden PREPROD pasó 1/1 y el cliente pasó 9 pruebas Node.
- Build Vite en el worktree limpio: `client/dist` ocupa 2.655.551 bytes; el PDF worker es 1.264.342 bytes, PDF.js lazy 599.638 bytes y el bundle común 235.179 bytes. El build termina correctamente con el aviso esperado de chunk PDF.js mayor a 500 kB.
- Auditorías `pnpm audit --prod` y completa: cero vulnerabilidades conocidas. `pnpm outdated -r` conserva cinco majors con razones de compatibilidad documentadas en `stack-tecnico.md`.

Los reportes de ruta, UX, golden y retiro están fuera de Git bajo `_recovery-work/galilei-stack-modernization1/reports/`. El runtime Search principal no se reconstruyó; PostgreSQL principal y el corpus no recibieron escrituras. La única escritura sobre Search principal fue el retiro exacto de índices V1/V2 descrito abajo.

## Search: recuperación y retiro controlado

La generación soportada por código actual es V4 activa con V3 de rollback. Los checks y runbooks ya no dependen de V1/V2. El cleanup ordinario sólo opera sobre la generación configurada. El 24 de octubre se retiraron por nombre exacto cinco V1 y un V2, todos no alias/no writer, después de validar el rollback V3 y la paridad V3/V4. Se liberaron 10.189.407.675 bytes (9,49 GiB) de store reportado; el espacio libre de C: aumentó 10.189.885.440 bytes.

El postcheck read-only confirmó OpenSearch 2.19.6 GREEN, 0 shards sin asignar, V1=0, V2=0, V3=69.313, V4=69.313 y alias/writer sólo en V4. PostgreSQL principal se verificó en transacción `READ ONLY`: `127.0.0.1:55432`, `buscador_juridico_civil_dev`, rol `bjc_dev`; outbox 223.815 procesados, 0 pendientes y 0 fallidos. La verificación no leyó ni imprimió secretos ni cambió esquema/corpus. El manifiesto previo y la evidencia de retiro están en `retirement-preflight.json` y `retirement-final.json` (locales, fuera de Git).

## Revisión final y estado de promoción

La candidata `refactor/galilei-stack-modernization1` conserva como base el `origin/dev` certificado `749ad15fb429beb652863a51dcb6eb5dd906f841`. En la revisión independiente inicial se encontró un P1: el preflight PREPROD podía compilar Nest antes de generar el cliente Prisma en un checkout limpio. El fix genera explícitamente Prisma antes del build de Nest; una prueba de regresión exige el orden generación → compilación → validación de destino → migraciones revisadas → build de release. La instalación congelada y los gates se repitieron desde un checkout limpio.

La revisión independiente del candidato corregido confirmó P0=0, P1=0, P2=3 y P3=1. Los P2 son: ocho journeys UI autenticados sin ejecutar por falta de credenciales QA; respuesta HTTP 200 del fallback SPA para rutas desconocidas pese a que la UI muestra 404; y metadata pública de fallo que se completa client-side. El P3 es de trazabilidad: el informe registra `pnpm install --frozen-lockfile` y `prisma validate` como PASS, pero no se conservaron transcripts de esos dos comandos. El preflight confirmó que `UX_QA_AUTH_ENABLED`, `UX_QA_AUTH_USER` y `UX_QA_AUTH_PASSWORD` no están configuradas. Por eso los journeys autenticados permanecen pendientes y no se promovió la candidata a `dev`; la UAT humana sigue siendo un gate separado. `main` y la base certificada de `dev` permanecen intactas.

Search principal conserva V4 activa y V3 de rollback; los seis índices V1/V2 ya fueron retirados por nombre exacto. PostgreSQL principal y el corpus no recibieron escrituras. Esta documentación describe una candidata revisada para continuar, no una promoción, UAT ni despliegue.

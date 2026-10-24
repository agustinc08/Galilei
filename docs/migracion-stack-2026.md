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
- UX público: 65 escenarios de 65 pasaron en 9 viewports, desde 390x844 hasta 2560x1440, sin errores de consola, warnings React, errores de página, fallas de red, misses de fixtures ni overflow horizontal. `/galilei`, `/personal` y `/spaces/manage` están registradas como rutas autenticadas; los 8 journeys de UI que requieren credenciales quedaron diferidos porque no había credenciales QA configuradas.
- Integración aislada: 7 suites PostgreSQL/11 tests y la suite ACL personal/restringida (1 test) pasaron; el test local de extracción/OCR pasó 6/6. ACL usó PostgreSQL QA en `127.0.0.1:55434` y OpenSearch QA en `127.0.0.1:19200`, nunca el Search principal. La limpieza dejó 0 documentos ni usuarios sintéticos y restauró el backlog PostgreSQL QA al valor de línea base.
- Golden de producto en QA aislada: 325/325 casos de adapter y 325/325 HTTP, 0 falsos positivos/negativos y 0 timeouts; paginación 325/325 sin duplicados, orden estable 4/4. El postcheck dejó 0 `CorpusDocument`, 0 colecciones sintéticas, 0 eventos pendientes/fallidos y 0 documentos en el alias QA.
- Build Vite: 3,0 s; `client/dist` ocupa 2.654.129 bytes. Los archivos mayores son el PDF worker (1.264.342 bytes), PDF.js lazy (599.638 bytes) y el bundle común (234.598 bytes). El build total del workspace tardó 14,3 s y terminó correctamente.
- Auditorías `pnpm audit --prod` y completa: cero vulnerabilidades conocidas. `pnpm outdated -r` conserva cinco majors con razones de compatibilidad documentadas en `stack-tecnico.md`.

Los reportes de ruta, UX, golden y retiro están fuera de Git bajo `_recovery-work/galilei-stack-modernization1/reports/`. El runtime Search principal no se reconstruyó; PostgreSQL principal y el corpus no recibieron escrituras. La única escritura sobre Search principal fue el retiro exacto de índices V1/V2 descrito abajo.

## Search: recuperación y retiro controlado

La generación soportada por código actual es V4 activa con V3 de rollback. Los checks y runbooks ya no dependen de V1/V2. El cleanup ordinario sólo opera sobre la generación configurada. El 24 de octubre se retiraron por nombre exacto cinco V1 y un V2, todos no alias/no writer, después de validar el rollback V3 y la paridad V3/V4. Se liberaron 10.189.407.675 bytes (9,49 GiB) de store reportado; el espacio libre de C: aumentó 10.189.885.440 bytes.

El postcheck read-only confirmó OpenSearch 2.19.6 GREEN, 0 shards sin asignar, V1=0, V2=0, V3=69.313, V4=69.313 y alias/writer sólo en V4. PostgreSQL principal se verificó en transacción `READ ONLY`: `127.0.0.1:55432`, `buscador_juridico_civil_dev`, rol `bjc_dev`; outbox 223.815 procesados, 0 pendientes y 0 fallidos. La verificación no leyó ni imprimió secretos ni cambió esquema/corpus. El manifiesto previo y la evidencia de retiro están en `retirement-preflight.json` y `retirement-final.json` (locales, fuera de Git).

## Pendiente antes de promover

1. Incorporar los fixes locales a un SHA revisable, hacer instalación `--frozen-lockfile` desde un worktree limpio en ese SHA y repetir los gates.
2. Completar revisión independiente sobre ese SHA exacto. La revisión anterior encontró 0 P0/P1; siguen como P2 el meta dinámico de fallos públicos y el HTTP 200 que da el fallback SPA para rutas desconocidas.
3. Resolver o aceptar explícitamente los ocho journeys de UI autenticados que quedaron diferidos por falta de credenciales QA; la UAT humana sigue siendo un gate separado.
4. Promover `dev` sólo cuando los gates técnicos estén completos; `main` permanece sin cambios.

Los fixes locales están validados por typecheck, lint, tests, build, Prisma validate y golden 325/325. Todavía no se incorporaron a un commit ni a un worktree limpio final; no se hicieron push ni promoción. Hasta superar esos pasos, este documento describe una candidata validada localmente, no un despliegue ni una promoción.

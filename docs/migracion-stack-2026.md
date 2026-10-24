# Migración de stack 2026

## Objetivo

Convertir `client/` de Next.js a una SPA React + Vite, mantener `server/` en NestJS + Prisma y unificar instalaciones en un workspace pnpm. La migración se realiza en `refactor/galilei-stack-modernization1`, basada en `749ad15fb429beb652863a51dcb6eb5dd906f841`.

## Revalidación del visor — 24 de octubre de 2026

El visor realmente no renderizaba: `react-pdf` 11.0.0 utilizaba PDF.js 6.3.289, pero la dependencia directa del cliente descargaba el worker 6.4.299. El navegador informaba `Unknown action from worker: test`. Se alineó `pdfjs-dist` en 6.3.289 para que biblioteca y worker coincidan; Vite empaqueta y sirve el worker local en el mismo origen. No se cambió el backend ni el contrato de autorización.

El UAT Workspace autenticado pasó 2/2 casos seriales y comprobó la página renderizada como canvas de 934×1210 con píxeles visibles. La API devolvió PDF 200 (933 bytes, firma `%PDF-`), Range 206 con `Content-Range`, descarga válida, denegación completa y Range 404, y documento ausente 404 sin filtrar rutas. El worker local respondió 200 con la misma versión PDF.js. El test ACL Sprint 15.6.1 pasó 1/1 contra PostgreSQL QA `127.0.0.1:55434`; QA OpenSearch fue `127.0.0.1:19200`. La UX pública pasó 22/22 y responsive 18/18; cliente y servidor pasaron lint, y el build Vite terminó con la advertencia informativa de chunk PDF.js >500 kB. PostgreSQL QA quedó con outbox 0/0. Las cuentas sintéticas, secretos temporales, storage y runtimes QA se eliminaron al cierre. UAT institucional sigue separada.

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
- UX público en worktree limpio: 63/63 verificaciones del reporter pasaron; Playwright 22/22 y matriz responsive 18/18 en viewports de 390x844 a 2560x1440, sin errores de consola, warnings React, errores de página, fallas de red, misses de fixtures ni overflow horizontal. El inventario de rutas es 40/40. `/galilei`, `/personal` y `/spaces/manage` están registradas como rutas autenticadas. En la revalidación del visor se ejecutaron dos casos autenticados de Workspace UAT con cuentas sintéticas; la suite QA mock continúa sin certificar ACL.
- Integración aislada: 7 suites PostgreSQL/11 tests y la suite ACL personal/restringida (1 test) pasaron; el test local de extracción/OCR pasó 6/6. ACL usó PostgreSQL QA en `127.0.0.1:55434` y OpenSearch QA en `127.0.0.1:19200`, nunca el Search principal. La limpieza dejó 0 documentos ni usuarios sintéticos y restauró el backlog PostgreSQL QA al valor de línea base.
- Golden de producto en QA aislada: 325/325 casos de adapter y 325/325 HTTP, 0 falsos positivos/negativos y 0 timeouts; paginación 325/325 sin duplicados, orden estable 4/4. El postcheck dejó 0 `CorpusDocument`, 0 colecciones sintéticas, 0 eventos pendientes/fallidos y 0 documentos en el alias QA.
- Instalación reproducible final del corte anterior: `pnpm install --frozen-lockfile` pasó en worktree detached sin `node_modules` ni cliente Prisma generado; Node 24.22.1 y pnpm 12.15.0. La revalidación del visor también se ejecutó con ese toolchain. En el corte anterior pasaron typecheck, lint, test y build; Jest 52 suites / 396 tests PASS, 1 suite / 10 tests opt-in omitidos, test de orden PREPROD 1/1 y cliente 9 pruebas Node.
- Build Vite en el worktree limpio: `client/dist` ocupa 2.655.551 bytes; el PDF worker es 1.264.342 bytes, PDF.js lazy 599.638 bytes y el bundle común 235.179 bytes. El build termina correctamente con el aviso esperado de chunk PDF.js mayor a 500 kB.
- Auditorías `pnpm audit --prod` y completa: cero vulnerabilidades conocidas. `pnpm outdated -r` conserva cinco majors con razones de compatibilidad documentadas en `stack-tecnico.md`.

Los reportes de ruta, UX, golden y retiro están fuera de Git bajo `_recovery-work/galilei-stack-modernization1/reports/`. El runtime Search principal no se reconstruyó; PostgreSQL principal y el corpus no recibieron escrituras. La única escritura sobre Search principal fue el retiro exacto de índices V1/V2 descrito abajo.

## Search: recuperación y retiro controlado

La generación soportada por código actual es V4 activa con V3 de rollback. Los checks y runbooks ya no dependen de V1/V2. El cleanup ordinario sólo opera sobre la generación configurada. El 24 de octubre se retiraron por nombre exacto cinco V1 y un V2, todos no alias/no writer, después de validar el rollback V3 y la paridad V3/V4. Se liberaron 10.189.407.675 bytes (9,49 GiB) de store reportado; el espacio libre de C: aumentó 10.189.885.440 bytes.

El postcheck read-only confirmó OpenSearch 2.19.6 GREEN, 0 shards sin asignar, V1=0, V2=0, V3=69.313, V4=69.313 y alias/writer sólo en V4. PostgreSQL principal se verificó en transacción `READ ONLY`: `127.0.0.1:55432`, `buscador_juridico_civil_dev`, rol `bjc_dev`; outbox 223.815 procesados, 0 pendientes y 0 fallidos. La verificación no leyó ni imprimió secretos ni cambió esquema/corpus. El manifiesto previo y la evidencia de retiro están en `retirement-preflight.json` y `retirement-final.json` (locales, fuera de Git).

## Revisión final y promoción a DEV

La rama `refactor/galilei-stack-modernization1` partió del `origin/dev` certificado `749ad15fb429beb652863a51dcb6eb5dd906f841`. En la revisión independiente inicial se encontró un P1: el preflight PREPROD podía compilar Nest antes de generar el cliente Prisma en un checkout limpio. El fix genera explícitamente Prisma antes del build de Nest; una prueba de regresión exige el orden generación → compilación → validación de destino → migraciones revisadas → build de release. La instalación congelada y los gates se repitieron desde un checkout limpio.

La revisión independiente del candidato corregido, anterior a esta revalidación, confirmó P0=0, P1=0, P2=3 y P3=1. Registró como P2 ocho journeys UI autenticados todavía no ejecutados en ese corte, HTTP 200 del fallback SPA para rutas desconocidas y metadata pública de fallo completada client-side; el P3 fue la falta de transcripts conservados de `pnpm install --frozen-lockfile` y `prisma validate`. La revalidación cerró el flujo Workspace UAT del visor con credenciales sintéticas y el test ACL enfocado. El diff del cierre del visor se revisó y la verificación fresca confirmó typecheck, lint, suites, build y ausencia de dependencias de recuperación V1/V2. Esa revalidación no sustituye aceptación humana ni vuelve a auditar los otros hallazgos P2/P3.

El 24 de octubre de 2026 se publicó el candidato revisado y se promovió a `origin/dev` mediante fast-forward normal: `749ad15fb429beb652863a51dcb6eb5dd906f841` → `82aac83c437700ea6dd8bd7310743b6659429789`. `origin/main` permaneció en `83947656420a9d6f6c3cfb12b353eb7f2c293a28`; no se usó force. El commit `82aac83` incluye Vite, el arreglo de visor/navegación y la limpieza de referencias de test a V1/V2; esta actualización documental se publica como follow-up. Search conserva V4 activa y V3 de rollback; los seis índices V1/V2 se retiraron por nombre exacto. PostgreSQL principal y el corpus no recibieron escrituras. La promoción es a DEV local/remoto; UAT humana, preproducción, oficina y producción siguen pendientes.

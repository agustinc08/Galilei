# Migración de stack 2026

## Objetivo

Convertir `client/` de Next.js a una SPA React + Vite, mantener `server/` en NestJS + Prisma y unificar instalaciones en un workspace pnpm. La migración se realiza en `refactor/galilei-stack-modernization1`, basada en `749ad15fb429beb652863a51dcb6eb5dd906f841`.

## Resultado de arquitectura

- El cliente arranca desde `client/index.html` y `client/src/main.tsx`; Vite produce `client/dist`.
- React Router resuelve las rutas públicas y autenticadas con fallback SPA.
- El helper tipado de entorno lee variables `VITE_*`; API base y endpoints de build se configuran sin secretos en el bundle.
- No quedan imports funcionales desde `next/*`, `next.config.ts`, dependencia Next ni scripts `next build/start`.
- `server/` conserva NestJS + Prisma; las pruebas y builds generan el cliente Prisma sin conectar a una DB.
- Un `pnpm-lock.yaml` raíz fija el workspace `client/` + `server/`.

## Paridad y validaciones

- Inventario de rutas: 40 antes y 40 después; cero rutas faltantes o agregadas.
- Toolchain repetido desde el worktree con Node 24.22.1 y pnpm 12.15.0: `typecheck`, `lint`, `test` y `build` pasaron. El backend informó 0 errores y 0 warnings de ESLint; Jest pasó 52 suites y 396 tests, con 1 suite y 10 tests omitidos. El cliente pasó sus 9 pruebas Node.
- UX público: 65 escenarios de 65 pasaron en 9 viewports, desde 390x844 hasta 2560x1440, sin errores de consola, warnings React, errores de página, fallas de red, misses de fixtures ni overflow horizontal. `/galilei`, `/personal` y `/spaces/manage` están registradas como rutas autenticadas; los 8 journeys de UI que requieren credenciales quedaron diferidos porque no había credenciales QA configuradas.
- Integración aislada: 7 suites PostgreSQL/11 tests y la suite ACL personal/restringida (1 test) pasaron; el test local de extracción/OCR pasó 6/6. ACL usó PostgreSQL QA en `127.0.0.1:55434` y OpenSearch QA en `127.0.0.1:19200`, nunca el Search principal. La limpieza dejó 0 documentos ni usuarios sintéticos y restauró el backlog PostgreSQL QA al valor de línea base.
- Build Vite: 3,0 s; `client/dist` ocupa 2.654.129 bytes. Los archivos mayores son el PDF worker (1.264.342 bytes), PDF.js lazy (599.638 bytes) y el bundle común (234.598 bytes). El build total del workspace tardó 14,3 s y terminó correctamente.
- Auditorías `pnpm audit --prod` y completa: cero vulnerabilidades conocidas. `pnpm outdated -r` conserva cinco majors con razones de compatibilidad documentadas en `stack-tecnico.md`.

Los reportes de ruta y UX están fuera de Git bajo `_recovery-work/galilei-stack-modernization1/reports/`. El runtime Search no se reconstruyó y la base/corpus principales no recibieron escrituras.

## Search: recuperación y retiro controlado

La generación soportada por código actual es V4 activa con V3 de rollback. Los checks y runbooks ya no dependen de que V1 o V2 sean el alias activo. El cleanup ordinario del índice sólo opera sobre la generación configurada; V1/V2 se conservan hasta terminar su manifiesto, prueba aislada de recuperación y gate de retiro exacto.

El 24 de octubre se confirmó por lectura que OpenSearch 2.19.6 está GREEN, V3 y V4 tienen 69.313 documentos y `galilei-search-active` apunta únicamente a V4. También se identificaron cinco índices V1 (42.180 documentos cada uno) y uno V2 (69.313 documentos); no se borraron. El principal PostgreSQL `55432` no pudo reautenticarse desde esta sesión porque no hay `DATABASE_URL` ni contraseña disponible en el entorno. No se hizo wildcard delete, cutover ni rebuild del corpus histórico.

## Pendiente antes de promover

1. Crear un commit de la candidata, luego un worktree limpio a `FEATURE_HEAD`, instalar con `--frozen-lockfile` y repetir builds/tests.
2. Ejecutar la revisión independiente solicitada; la revisión todavía no se ha completado.
3. Reautenticar PostgreSQL principal y completar el manifiesto/outbox del gate V1/V2. No retirar esos índices sin volver a comprobar cada condición.
4. Promover a `dev` sólo con todos los gates aprobados; `main` no se modifica.

La promoción, los commits y los pushes siguen pendientes. Hasta superar esos pasos, este documento describe una candidata validada localmente, no un despliegue ni una promoción.

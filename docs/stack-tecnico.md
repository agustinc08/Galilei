# Stack técnico de Galilei

Estado de la rama de modernización, validado el 24 de octubre de 2026. El checkout principal y sus servicios no se modifican con estas validaciones.

## Versiones fijadas

| Componente | Versión | Uso |
| --- | --- | --- |
| Node.js | 24.22.1 | LTS; `engines` permite `>=24.15.0 <25` |
| pnpm | 12.15.0 | `packageManager` raíz; un lockfile para el workspace |
| React / React DOM | 19.3.1 | Interfaz SPA |
| Vite | 8.3.5 | Dev server y build estático en `client/dist` |
| React Router | 7.18.4 | Rutas, deep links e historial de la SPA |
| React-PDF / PDF.js | 11.0.0 / 6.3.289 | Visor de documentos; el worker local se empaqueta con Vite |
| TypeScript | 6.0.3 | Cliente y servidor |
| NestJS | 12.2.0 | API backend |
| Prisma ORM / CLI | 7.10.1 | Persistencia PostgreSQL y generación del cliente |
| OpenSearch JS client | 3.9.0 | Cliente del read model local |
| OpenSearch server | 2.19.6 | Runtime existente; no se actualiza en esta migración |
| ESLint | 9.39.5 | Lint del cliente y servidor |
| Jest / `@jest/globals` | 30.5.2 | Unit tests del backend, transformados como ESM |

Las versiones del runtime, gestor y framework se consultaron frente a fuentes oficiales el día de la validación. Node 24 permanece en LTS; pnpm 12.15.0 y Vite 8.3.5 tenían el tag estable `latest`.

## Workspace y comandos

La raíz define los paquetes `front` (`client/`) y `back` (`server/`) y administra `pnpm-lock.yaml`.

```powershell
pnpm install --frozen-lockfile
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm e2e
```

Los specs `*.integration.spec.ts` quedan fuera de la ejecución Jest predeterminada porque requieren servicios y fixtures QA configurados expresamente. No apuntes esos tests a PostgreSQL u OpenSearch principales.

En el candidato final, la instalación congelada se repitió desde un worktree limpio sin `node_modules` ni cliente Prisma generado. Typecheck, lint, test y build pasaron; el test incluye una regresión que exige generar Prisma antes del preflight Nest en PREPROD. La UI pública pasó Playwright 22/22 y responsive 18/18. La revalidación autenticada del espacio ejecutó los dos casos seriales de Workspace UAT y la prueba Sprint 15.6.1 ACL enfocada; ambas suites pasaron. No equivale a aceptación humana institucional.

## Motivos de compatibilidad

- Se conservan `eslint` y `@eslint/js` 9.39.5 en el mismo major: los plugins React y JSX accessibility fijados declaran peers hasta ESLint 9.
- Se conserva TypeScript 6.0.3: typescript-eslint 8.72 declara `<6.1.0` y ts-jest 29.4 declara `<7`.
- Se conserva `@types/node` 24.x para que los tipos disponibles coincidan con el runtime Node 24; el major 26 describe APIs de otro runtime.
- Se fija `pdfjs-dist` 6.3.289 porque `react-pdf` 11.0.0 usa esa misma versión; el worker debe compartir versión con la biblioteca que procesa el PDF. Vite lo sirve como asset local versionado, sin CDN.
- Se conserva Prisma 7.10.1, la versión GA compatible con esta aplicación. Prisma 8 aparece como release candidate en el registro consultado y no se habilita en este cambio.
- `server/tsconfig.json` configura `ts-node.experimentalResolver` para que los scripts TypeScript en ejecución directa resuelvan los imports `.js` que genera el cliente Prisma 7.
- `@opensearch-project/opensearch` 3.9.0 sólo actualiza el cliente JavaScript; el servidor permanece 2.19.6.

Las auditorías `pnpm audit --prod` y `pnpm audit` no encontraron vulnerabilidades conocidas durante esta validación. Los avisos de paquetes transitivos obsoletos se registran aparte; no hay dependencias directas deprecated sin explicación.

El `pnpm outdated --recursive` del 24-10-2026 marcó seis dependencias directas: `pdfjs-dist` (alineada con React-PDF), `@eslint/js`/`eslint` (peers de plugins), `@types/node` (major del runtime), TypeScript (peer ranges del toolchain) y Prisma 8 (el tag encontrado era RC). Las razones de compatibilidad están descritas arriba; no se promovió un major incompatible ni una versión prerelease.

## Search y datos

PostgreSQL es la fuente de verdad. OpenSearch es un read model: V4 es el target activo y writer; V3 se reserva como rollback. El cleanup ordinario sólo evalúa índices de la generación configurada, por lo que no puede retirar V3 mientras el servicio opera en V4. V1/V2 fueron retirados el 24-10-2026 con seis solicitudes por nombre físico exacto; se conservaron V3/V4 y se liberaron 9,49 GiB. El manifiesto y postcheck están en la evidencia local ignorada de `galilei-stack-modernization1`.

Para operaciones PostgreSQL de desarrollo, el guard sólo admite `127.0.0.1:55432`, base `buscador_juridico_civil_dev`, rol `bjc_dev`. Ningún comando de esta migración aplica migraciones ni modifica el corpus real.

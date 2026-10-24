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

## Motivos de compatibilidad

- Se conserva ESLint 9.39.5: los plugins React y JSX accessibility fijados todavía declaran peers hasta ESLint 9.
- Se conserva TypeScript 6.0.3: typescript-eslint 8.72 declara `<6.1.0` y ts-jest 29.4 declara `<7`.
- Se conserva `@types/node` 24.x para que los tipos disponibles coincidan con el runtime Node 24; el major 26 describe APIs de otro runtime.
- Se conserva Prisma 7.10.1, la versión GA compatible con esta aplicación. Prisma 8 aparece como release candidate en el registro consultado y no se habilita en este cambio.
- `@opensearch-project/opensearch` 3.9.0 sólo actualiza el cliente JavaScript; el servidor permanece 2.19.6.

Las auditorías `pnpm audit --prod` y `pnpm audit` no encontraron vulnerabilidades conocidas durante esta validación. Los avisos de paquetes transitivos obsoletos se registran aparte; no hay dependencias directas deprecated sin explicación.

## Search y datos

PostgreSQL es la fuente de verdad. OpenSearch es un read model: V4 es el target activo y writer; V3 se reserva como rollback. El cleanup ordinario sólo evalúa índices de la generación configurada, por lo que no puede retirar V3 mientras el servicio opera en V4. V1/V2 requieren un manifiesto físico exacto y un paso explícito de retiro; no se borran por wildcard.

Para operaciones PostgreSQL de desarrollo, el guard sólo admite `127.0.0.1:55432`, base `buscador_juridico_civil_dev`, rol `bjc_dev`. Ningún comando de esta migración aplica migraciones ni modifica el corpus real.

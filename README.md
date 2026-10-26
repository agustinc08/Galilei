# Galilei — Buscador Jurídico Civil

Galilei reúne jurisprudencia, corpus documental, Digesto y espacios de trabajo privados en una aplicación web. El repositorio contiene dos paquetes dentro de un workspace pnpm: `client/` (React, Vite y TypeScript) y `server/` (NestJS, Prisma y PostgreSQL).

## Stack y estructura

- Runtime: Node.js 24 LTS; el entorno validado usa 24.22.1.
- Gestor: pnpm 12.15.0, fijado en el manifiesto raíz.
- Cliente: React 19, Vite 8 y React Router 7; genera una SPA en `client/dist`.
- Visor PDF: `react-pdf` 11 con `pdfjs-dist` 6.3.289 y worker empaquetado por Vite en el mismo origen.
- API: NestJS 12 y Prisma 7.
- Search: PostgreSQL es la fuente de verdad; OpenSearch 2.19.6 sirve el read model. V4 es activa, V3 se conserva para rollback y V1/V2 históricas están retiradas.
- `docs/`: guías técnicas, historial de migración y runbooks BJC.

Ver [stack técnico](docs/stack-tecnico.md), [migración 2026](docs/migracion-stack-2026.md) y [estructura del proyecto](docs/estructura-proyecto.md).

## Requisitos e instalación

Usá Node `>=24.15.0 <25` y pnpm `12.15.0`.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

El comando raíz levanta el backend en `http://127.0.0.1:4000` y Vite en `http://localhost:4001`. El backend necesita PostgreSQL 16 y OpenSearch 2.19.6 locales; la configuración de desarrollo vive en `server/.env.development.local` y no se versiona. La UI usa `VITE_API_URL=/api` y el proxy de Vite apunta al backend local. Revisá [el runbook local](docs/uat/technical-runbook.md) para preparar, comprobar y detener los servicios.

Comandos raíz disponibles: `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck` y `pnpm e2e`. Para operar un paquete por separado, usá `pnpm --filter front ...` o `pnpm --filter back ...`.

## Investigación reproducible

Las colecciones propias se pueden exportar como dossiers ZIP verificables; las búsquedas guardadas muestran fallos nuevos desde su publicación en Galilei, y las fichas públicas enlazan decisiones del mismo expediente con normalización determinística. Alcance, ACL, límites y pruebas: [dossiers](docs/research-bundles.md), [novedades](docs/saved-search-novelties.md) y [gobierno del repositorio](docs/repo-governance.md).

Las pruebas backend predeterminadas ejecutan suites unitarias y omiten `*.integration.spec.ts`; esas suites requieren una base y servicios QA explícitos. No apuntes pruebas o migraciones a producción ni a servidores institucionales.

## Datos locales

El corpus DEV real vive en `_dev-corpus-storage/`; contiene blobs referenciados por PostgreSQL y se conserva fuera de Git. PostgreSQL y OpenSearch principales, backups, credenciales y evidencia operativa también viven fuera del repositorio.

Antes de una operación Prisma que escriba, ejecutá la acción protegida correspondiente mediante `server/scripts/with-dev-db-guard.cjs`. El guard exige `127.0.0.1:55432/buscador_juridico_civil_dev`, rol `bjc_dev`. No imprimas ni copies `.env` o secretos.

La política de índices, recuperación y retiro de generaciones históricas está en [operación de Search](docs/integracion/123-SEARCH-MIGRATION-OPERATIONS.md). El cleanup rutinario sólo considera la generación configurada; V3 debe conservarse como rollback mientras V4 sea la activa.

Las carpetas históricas `JurisprudenciaN/back/data`, `JurisprudenciaN/back/uploads` y `digesto/server/pdfs` pertenecen a checkout/source legado. La configuración institucional del backend las trata como orígenes read-only; un clon limpio debe configurar sus propios roots antes de inventariar o ingerir.

## Pruebas de usuarios

La [guía UAT](docs/uat/guia-prueba-usuarios.md) y la [plantilla de feedback](docs/uat/feedback-usuarios.md) son para testers no técnicos. El [inventario de superficies](docs/uat/product-surface-inventory.json) enumera rutas, perfiles, dependencias, APIs y evidencia de cobertura.

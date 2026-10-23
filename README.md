# Galilei — Buscador Jurídico Civil

Galilei reúne jurisprudencia, corpus documental, Digesto y espacios de trabajo privados en una aplicación web. El código activo queda separado en dos aplicaciones independientes: client/ (Next.js) y server/ (NestJS, Prisma y PostgreSQL). Cada una conserva su propio manifiesto y lockfile pnpm; la raíz no declara un workspace que pueda mezclar instalaciones.

## Estructura

- client/: interfaz Next.js, pruebas Playwright y harness de UX.
- server/: API NestJS, Search, ACL, Prisma, migraciones y scripts protegidos.
- docs/: guías del repositorio y documentación de integración BJC.
- legacy/digesto/: aplicación antigua CRA/Nest conservada como referencia; no es el runtime de Galilei.
- docker-compose.yml y docker-compose.dev.yml: recetas locales optativas, no servicios activos.

Ver [estructura del proyecto](docs/estructura-proyecto.md), [inventario de raíz](docs/inventario-raiz.md), [guía de inicio BJC](docs/integracion/BJC-START-HERE.md) y [archivo histórico Digesto](legacy/README.md).

## Desarrollo local

Usá pnpm en cada aplicación, sin regenerar lockfiles con npm.

Cliente, desde client/: pnpm install --frozen-lockfile y pnpm dev.

Servidor, desde server/: pnpm install --frozen-lockfile y pnpm start:dev.

Las pruebas y builds se ejecutan desde la aplicación correspondiente con sus scripts pnpm. Antes de cualquier operación Prisma o prueba que escriba en la base, usar node scripts/with-dev-db-guard.cjs <acción> desde server/; el guard exige la base DEV local exacta (127.0.0.1:55432/buscador_juridico_civil_dev, rol bjc_dev). No ejecutar migraciones directas ni leer/imprimir .env.development.local.

## Datos y servicios locales

El corpus real, PostgreSQL, OpenSearch, backups y evidencia operativa viven fuera de Git en raíces locales ignoradas. La reorganización cambia sólo el código versionado: no mueve documentos, bases, índices, secretos ni runtimes. El inventario registra qué se conserva y por qué. No conectar a producción ni a servidores institucionales.

Las rutas históricas JurisprudenciaN/back/data, JurisprudenciaN/back/uploads y digesto/server/pdfs identifican fuentes locales preexistentes del checkout original. No son carpetas de código actual ni se trasladan por esta reorganización; se preservan y permanecen ignoradas.

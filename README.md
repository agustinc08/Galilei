# Galilei — Buscador Jurídico Civil

Galilei reúne jurisprudencia, corpus documental, Digesto y espacios de trabajo privados en una aplicación web. El código activo queda separado en dos aplicaciones independientes: client/ (Next.js) y server/ (NestJS, Prisma y PostgreSQL). Cada una conserva su propio manifiesto y lockfile pnpm; la raíz no declara un workspace que pueda mezclar instalaciones.

## Estructura

- client/: interfaz Next.js, pruebas Playwright y harness de UX.
- server/: API NestJS, Search, ACL, Prisma, migraciones y scripts protegidos.
- docs/: guías del repositorio y documentación de integración BJC.
- docker-compose.yml y docker-compose.dev.yml: recetas locales optativas, no servicios activos.

Digesto sigue como dominio funcional dentro de client/ y server/. La aplicación antigua CRA/Nest que vivía en `legacy/digesto/` fue retirada porque no tiene dependencias activas; Git conserva su historia.

Ver [estructura del proyecto](docs/estructura-proyecto.md), [inventario de raíz](docs/inventario-raiz.md) y [guía de inicio BJC](docs/integracion/BJC-START-HERE.md).

## Desarrollo local

Usá pnpm en cada aplicación, sin regenerar lockfiles con npm.

Cliente, desde client/: pnpm install --frozen-lockfile y pnpm dev.

Servidor, desde server/: pnpm install --frozen-lockfile y pnpm start:dev.

Las pruebas y builds se ejecutan desde la aplicación correspondiente con sus scripts pnpm. Antes de cualquier operación Prisma o prueba que escriba en la base, usar node scripts/with-dev-db-guard.cjs <acción> desde server/; el guard exige la base DEV local exacta (127.0.0.1:55432/buscador_juridico_civil_dev, rol bjc_dev). No ejecutar migraciones directas ni leer/imprimir .env.development.local.

## Datos y servicios locales

El corpus DEV real vive en `_dev-corpus-storage/` y contiene los blobs locales referenciados por PostgreSQL para Viewer y descarga; no borrarlo ni versionarlo. PostgreSQL, OpenSearch, backups, configuración de oficina y evidencia operativa viven fuera de Git en raíces locales ignoradas. El inventario explica qué se conserva y por qué. No conectar a producción ni a servidores institucionales.

`_local-setup/office-runtime-transfer.rar` contiene el paquete único de transferencia para la PC de oficina: dump PostgreSQL DEV y blobs del corpus, sin secretos. Los manifiestos y checksums acompañantes permiten validar el archivo antes del traspaso. Los runtimes y datos históricos de `_recovery-work/` no son parte del paquete.

Las rutas históricas `JurisprudenciaN/back/data`, `JurisprudenciaN/back/uploads` y `digesto/server/pdfs` pertenecen al checkout original y se conservan aparte; no son el runtime de las aplicaciones actuales. La allowlist PDF de `server/scripts/dev/institutional-pdf-roots.json` las trata como fuentes locales read-only: un clon limpio debe configurar sus propios roots antes de inventariar o ingerir.

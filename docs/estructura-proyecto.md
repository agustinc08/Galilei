# Estructura del proyecto

## Aplicaciones

client/ es el frontend Next.js, con UX y pruebas Playwright.
server/ es la API NestJS, Search, ACL, Prisma, migraciones y scripts locales.
docs/ contiene guías comunes; docs/integracion/ contiene los documentos maestros BJC.

Digesto es una funcionalidad vigente del producto integrada en client/ y server/. El código de la aplicación anterior CRA/Nest se quitó de `legacy/digesto/` porque no existía una dependencia de build, importación o runtime; el historial sigue accesible en Git.

client y server son paquetes pnpm independientes, con lockfiles propios. No hay un workspace pnpm en la raíz, para evitar que la instalación cambie el grafo de dependencias existente. La antigua carpeta JurisprudenciaN ya no es un contenedor de aplicaciones.

## Comandos habituales

Instalar y ejecutar cada paquete desde su directorio:

- Cliente: pnpm install --frozen-lockfile, pnpm dev, pnpm build, pnpm lint.
- Servidor: pnpm install --frozen-lockfile, pnpm start:dev, pnpm build.
- DB / Prisma: desde server, pasar las acciones autorizadas por node scripts/with-dev-db-guard.cjs <acción>. El guard verifica host loopback, puerto, DB y rol antes de lanzar.

El target DEV es PostgreSQL nativo 127.0.0.1:55432, base buscador_juridico_civil_dev, rol bjc_dev. El guard prefiere la configuración bajo server/ y sólo durante la transición puede resolver el archivo previo exacto desde el Git common root; valida la identidad antes de operar y nunca debe imprimirse. Los tests PostgreSQL con fixtures se habilitan por acción explícita del guard; el benchmark de workspaces limpia los eventos de outbox de sus IDs sintéticos en el teardown. Las reglas operativas completas están en AGENTS.md y en docs/integracion/BJC-START-HERE.md.

## Datos y runtimes fuera del código

- _dev-corpus-storage/: storage DEV real, 17.098 blobs content-addressed referenciados por `CorpusDocumentFile`; el backend lo usa para leer el PDF del Viewer y descargarlo. El path por defecto parte de `server/` y puede cambiar sólo con `BJC_CORPUS_STORAGE_PATH`. No borrar ni versionar.
- _recovery-work/: evidencia y runtimes locales ignorados. El principal OpenSearch 2.19.6 mantiene su data en `_recovery-work/search-engine-integration1/runtime/data`; el runtime vive allí por historia y no se mueve antes de la migración de oficina. Está GREEN con V4, 69.313 documentos, alias y writer en V4, outbox 0 pending/0 failed. Las herramientas CLI leen primero `server/.env.development.local`; durante esta transición local pueden recurrir al archivo privado del checkout histórico si falta el nuevo. Para Sytec10, provisionar configuración privada bajo `server/` con `OPENSEARCH_SEARCH_SCHEMA_VERSION=4` y la topología compatible; nunca versionar ese archivo. La verificación aislada fijó `BJC_SEARCH_TOPOLOGY=fresh-v4` sólo en el proceso de status porque la configuración histórica no declara el schema. Los QA cerrados se eliminan al conservar evidencia pequeña.
- _recovery-backups/: backups locales fuera de Git; conservar el backup validado y cualquier punto pre-migración único.
- _local-setup/: scripts de transferencia y un único `office-runtime-transfer.rar` con dump DEV y corpus; se eliminó la copia expandida redundante.
- _legacy-audit-work/: informes y evidencia histórica única, ignorada por Git.
- JurisprudenciaN/back/data, JurisprudenciaN/back/uploads y digesto/server/pdfs: raíces históricas de documentos en el checkout original. Son datos read-only y no se mueven junto con el código.

La limpieza de raíz no mueve corpus físico, PDFs, PGDATA, índices Search, archivos de configuración locales ni credenciales. Los datos históricos bajo `JurisprudenciaN/back/data`, `JurisprudenciaN/back/uploads` y `digesto/server/pdfs` permanecen dentro del checkout original protegido.

## Compose

Los archivos Compose son plantillas optativas y no representan los servicios activos del equipo principal. docker-compose.dev.yml reserva el puerto loopback 55432, ocupado por el PostgreSQL nativo DEV; no iniciarlo en esa máquina. docker-compose.yml es una base local desechable en 55433, requiere una contraseña por entorno y no debe confundirse con la DB principal.

## Compatibilidad y rutas

Los scripts del backend se ejecutan desde server/ y resuelven la raíz compartida en su directorio padre; sus salidas locales van a _recovery-work/. Las raíces PDF históricas se enumeran en server/scripts/dev/institutional-pdf-roots.json y siguen siendo fuentes read-only fuera del producto. Esa configuración sólo funciona en una máquina que conserve esos directorios; un clon limpio debe provisionar/configurar sus propios roots locales antes de ejecutar inventarios o ingestas. No se redirigen a carpetas vacías ni se mueven durante esta reorganización.

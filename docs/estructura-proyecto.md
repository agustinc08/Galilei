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
- _recovery-work/: evidencia local ignorada y el runtime principal OpenSearch 2.19.6 en `_recovery-work/search-engine-integration1/runtime/data`. Está GREEN con V4, 69.313 documentos en V3/V4, alias y writer en V4. Los QA terminados fueron detenidos y sus runtimes eliminados; aquí quedan informes pequeños, patches únicos e índices históricos V1/V2 preservados. La distribución reutilizable OpenSearch se conserva aparte para provisión autorizada. No mover ni borrar Search principal durante limpieza ordinaria.
- _recovery-backups/: backups locales fuera de Git; conservar el backup validado y cualquier punto pre-migración único.
- _local-setup/: cinco scripts pequeños de preparación/auditoría. `office-runtime-transfer.rar` se eliminó tras confirmar que no contenía material único; la PC de oficina debe obtener el source desde Git.
- _legacy-audit-work/: SQLite históricas y un PDF único preservado, más informes de reconciliación; evidencia local ignorada por Git.
- `JurisprudenciaN/`, `digesto/` y `docs-integracion/`: ausentes en la raíz normalizada. Se retiró el checkout histórico después de preservar/reconciliar sus cinco cambios y se preservaron los datos únicos bajo `_legacy-audit-work/preserved-source/`.

La limpieza preserva el corpus físico, PGDATA principal, Search principal, configuración privada y credenciales. Los documentos históricos únicos conservados están bajo `_legacy-audit-work/preserved-source/`; los PDFs que duplicaban el corpus fueron retirados sólo tras cotejar hashes.

## Compose

Los archivos Compose son plantillas optativas y no representan los servicios activos del equipo principal. docker-compose.dev.yml reserva el puerto loopback 55432, ocupado por el PostgreSQL nativo DEV; no iniciarlo en esa máquina. docker-compose.yml es una base local desechable en 55433, requiere una contraseña por entorno y no debe confundirse con la DB principal.

## Compatibilidad y rutas

Los scripts del backend se ejecutan desde server/ y resuelven la raíz compartida en su directorio padre; sus salidas locales van a _recovery-work/. Las raíces PDF históricas se enumeran en server/scripts/dev/institutional-pdf-roots.json y siguen siendo fuentes read-only fuera del producto. Esa configuración sólo funciona en una máquina que conserve esos directorios; un clon limpio debe provisionar/configurar sus propios roots locales antes de ejecutar inventarios o ingestas. No se redirigen a carpetas vacías ni se mueven durante esta reorganización.

# Estructura del proyecto

## Aplicaciones

`client/` es una SPA React + Vite + TypeScript, con React Router y pruebas Playwright.
`server/` es la API NestJS, Search, ACL, Prisma, migraciones y scripts locales.
`docs/` contiene guías comunes; `docs/integracion/` contiene los documentos maestros BJC.

Digesto es una funcionalidad vigente del producto integrada en client/ y server/. El código de la aplicación anterior CRA/Nest se quitó de `legacy/digesto/` porque no existía una dependencia de build, importación o runtime; el historial sigue accesible en Git.

La raíz define un único workspace pnpm con `client/` y `server/`, y un solo `pnpm-lock.yaml`. La antigua carpeta `JurisprudenciaN` ya no es un contenedor de aplicaciones.

## Comandos habituales

Desde la raíz, Node 24 LTS y pnpm 12.15.0:

- Instalar: `pnpm install --frozen-lockfile`.
- Ejecutar ambos paquetes: `pnpm dev`.
- Compilar, probar, lint y typecheck: `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck`.
- Ejecutar un paquete: `pnpm --filter front <comando>` o `pnpm --filter back <comando>`.
- DB / Prisma: desde `server/`, usar `node scripts/with-dev-db-guard.cjs <acción>`. El guard verifica host loopback, puerto, DB y rol antes de lanzar.

El target DEV es PostgreSQL nativo 127.0.0.1:55432, base buscador_juridico_civil_dev, rol bjc_dev. El guard prefiere la configuración bajo server/ y sólo durante la transición puede resolver el archivo previo exacto desde el Git common root; valida la identidad antes de operar y nunca debe imprimirse. Los tests PostgreSQL con fixtures se habilitan por acción explícita del guard; el benchmark de workspaces limpia los eventos de outbox de sus IDs sintéticos en el teardown. Las reglas operativas completas están en AGENTS.md y en docs/integracion/BJC-START-HERE.md.

## Datos y runtimes fuera del código

- _dev-corpus-storage/: storage DEV real, 17.098 blobs content-addressed referenciados por `CorpusDocumentFile`; el backend lo usa para leer el PDF del Viewer y descargarlo. El path por defecto parte de `server/` y puede cambiar sólo con `BJC_CORPUS_STORAGE_PATH`. No borrar ni versionar.
- _recovery-work/: evidencia local ignorada y runtimes QA/principales. El OpenSearch principal conocido es 2.19.6, GREEN, con 69.313 documentos en V3 y V4; `galilei-search-active` y el writer apuntan a V4, con V3 como rollback. Los índices V1/V2 sólo pueden retirarse con manifiesto exacto y verificación de ausencia de dependencias de recuperación. No mover ni borrar Search principal durante limpieza ordinaria.
- _recovery-backups/: backups locales fuera de Git; conservar el backup validado y cualquier punto pre-migración único.
- _local-setup/: cinco scripts pequeños de preparación/auditoría. `office-runtime-transfer.rar` se eliminó tras confirmar que no contenía material único; la PC de oficina debe obtener el source desde Git.
- _legacy-audit-work/: SQLite históricas y un PDF único preservado, más informes de reconciliación; evidencia local ignorada por Git.
- `JurisprudenciaN/`, `digesto/` y `docs-integracion/`: ausentes en la raíz normalizada. Se retiró el checkout histórico después de preservar/reconciliar sus cinco cambios y se preservaron los datos únicos bajo `_legacy-audit-work/preserved-source/`.

La limpieza preserva el corpus físico, PGDATA principal, Search principal, configuración privada y credenciales. Los documentos históricos únicos conservados están bajo `_legacy-audit-work/preserved-source/`; los PDFs que duplicaban el corpus fueron retirados sólo tras cotejar hashes.

## Compose

Los archivos Compose son plantillas optativas y no representan los servicios activos del equipo principal. docker-compose.dev.yml reserva el puerto loopback 55432, ocupado por el PostgreSQL nativo DEV; no iniciarlo en esa máquina. docker-compose.yml es una base local desechable en 55433, requiere una contraseña por entorno y no debe confundirse con la DB principal.

## Compatibilidad y rutas

Los scripts del backend se ejecutan desde server/ y resuelven la raíz compartida en su directorio padre; sus salidas locales van a _recovery-work/. Las raíces PDF históricas se enumeran en server/scripts/dev/institutional-pdf-roots.json y siguen siendo fuentes read-only fuera del producto. Esa configuración sólo funciona en una máquina que conserve esos directorios; un clon limpio debe provisionar/configurar sus propios roots locales antes de ejecutar inventarios o ingestas. No se redirigen a carpetas vacías ni se mueven durante esta reorganización.

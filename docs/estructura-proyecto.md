# Estructura del proyecto

## Aplicaciones

client/ es el frontend Next.js, con UX y pruebas Playwright.
server/ es la API NestJS, Search, ACL, Prisma, migraciones y scripts locales.
legacy/digesto/ preserva el código anterior Digesto, sólo como referencia.
docs/ contiene guías comunes; docs/integracion/ contiene los documentos maestros BJC.

client y server son paquetes pnpm independientes, con lockfiles propios. No hay un workspace pnpm en la raíz, para evitar que la instalación cambie el grafo de dependencias existente. La antigua carpeta JurisprudenciaN ya no es un contenedor de aplicaciones.

## Comandos habituales

Instalar y ejecutar cada paquete desde su directorio:

- Cliente: pnpm install --frozen-lockfile, pnpm dev, pnpm build, pnpm lint.
- Servidor: pnpm install --frozen-lockfile, pnpm start:dev, pnpm build.
- DB / Prisma: desde server, pasar las acciones autorizadas por node scripts/with-dev-db-guard.cjs <acción>. El guard verifica host loopback, puerto, DB y rol antes de lanzar.

El target DEV es PostgreSQL nativo 127.0.0.1:55432, base buscador_juridico_civil_dev, rol bjc_dev. El guard prefiere la configuración bajo server/ y sólo durante la transición puede resolver el archivo previo exacto desde el Git common root; valida la identidad antes de operar y nunca debe imprimirse. Las reglas operativas completas están en AGENTS.md y en docs/integracion/BJC-START-HERE.md.

## Datos y runtimes fuera del código

- _dev-corpus-storage/: corpus real local, preservado; nunca versionar ni borrar como parte de una reorganización.
- _recovery-work/: informes, QA y runtimes locales; ignorado por Git. La instancia principal de OpenSearch y evidencias necesarias permanecen allí.
- _recovery-backups/: backups de recuperación preservados fuera de Git.
- _local-setup/: material local de configuración/transferencia.
- JurisprudenciaN/back/data, JurisprudenciaN/back/uploads y digesto/server/pdfs: raíces históricas de documentos en el checkout original. Son datos read-only y no se mueven junto con el código.

La reorganización no mueve corpus físico, PDFs, PGDATA, índices Search, archivos de configuración locales ni credenciales.

## Compose

Los archivos Compose son plantillas optativas y no representan los servicios activos del equipo principal. docker-compose.dev.yml reserva el puerto loopback 55432, ocupado por el PostgreSQL nativo DEV; no iniciarlo en esa máquina. docker-compose.yml es una base local desechable en 55433, requiere una contraseña por entorno y no debe confundirse con la DB principal.

## Compatibilidad y rutas

Las rutas de recuperación y almacenamiento se resuelven desde la raíz del repositorio o desde las carpetas hermanas client/server. Las fuentes históricas que mantienen nombre antiguo aparecen explícitamente en la configuración local de inventario PDF; no se reescribieron para apuntar a una carpeta vacía.

# Misión 5.1 — Recuperación de entorno

## Estado inicial

La copia de proyecto encontrada y utilizada está en C:\proyecto triple; la ruta previa bajo OneDrive no existe. Windows 11 Home, build 26300; proceso sin privilegios de administrador.

Node v24.19.0 y pnpm 11.19.0 estaban disponibles, pero npm no estaba en PATH. El backend tenía package-lock.json, node_modules/.ignored, un node_modules/.pnpm de otra instalación y shims con rutas absolutas a la ubicación anterior. El build fallido de la misión previa había dejado salida parcial en back/dist (475 archivos; no debe considerarse un build válido). No existía pnpm-lock.yaml en el backend.

Docker y PostgreSQL CLI no están instalados. WSL responde que el Subsistema de Windows para Linux no está instalado. No había listener PostgreSQL en 5432 ni en 55432.

## Causa del problema

La instalación anterior mezcló artefactos de pnpm y paquetes npm preservados. Las rutas antiguas ya no correspondían a la ubicación actual del proyecto, y los módulos bajo .ignored no se resolvían como una instalación normal al compilar. pnpm 11 también bloquea scripts de dependencias hasta definir cuáles pueden ejecutarse.

Docker requiere el backend WSL2 para Linux containers en esta configuración. La primera habilitación de WSL requiere permisos administrativos; esta sesión no los tiene.

## Backup realizado

Se creó C:\proyecto triple\_recovery-backups\mission-5.1-20261007-125453 antes de cambiar dependencias. Contiene los manifiestos y lockfiles originales, configuración Prisma/Nest/TypeScript, Compose dev, documentos 19–23, los 475 archivos de dist anterior y una copia de node_modules.

Comparación de node_modules por ruta relativa: 73.650 archivos en origen y copia, cero faltantes, cero extras y cero diferencias de longitud. No se calcularon hashes individuales de todos esos archivos. Además, el node_modules original activo se movió intacto a server\node_modules.active-original dentro del backup. El package-lock original tiene SHA-256 F1160ABFFCC5E8865DFF117D488B61E2753853659DB3AD6BABAC30D5E39B3FEE. No se incluyó ningún .env ni credencial.

## Recuperación pnpm

El backend se clonó en _recovery-work\mission-5.1\backend sin .env, datos, uploads ni node_modules. pnpm import creó un lock reproducido desde package-lock. La instalación limpia resolvió 822 dependencias y pnpm install --frozen-lockfile terminó correctamente en el clon.

Se aprobaron únicamente los scripts necesarios de @prisma/engines, prisma, sqlite3 y bcrypt. Se dejaron bloqueados los scripts de @nestjs/core (OpenCollective), @scarf/scarf (telemetría) y unrs-resolver (resolver de lint no requerido para estas comprobaciones).

Tras pasar las verificaciones en el clon, se promovió la instalación al backend activo y se repitió pnpm install --frozen-lockfile. package.json fija packageManager en pnpm@11.19.0. El lock npm del backend se retiró sólo después de validar import, instalación, Prisma, tests y build; su copia está en el backup. El package-lock del frontend no se modificó.

## Prisma

Resultado: PASS. Prisma Client v7.8.0 se generó en el clon y en el backend activo. Se definió temporalmente una URL ficticia de loopback para la generación. Prisma generate no abrió una conexión y no se ejecutó migrate.

## Search spike

Resultado: PASS. 5 suites y 35 tests pasaron, con SQLite legacy en modo de solo lectura. Comando: pnpm exec jest --runInBand --testTimeout=120000. Tiempo observado en el backend activo: 16,747 ms. El timeout ampliado es sólo parámetro de ejecución; el código de test no se modificó.

La primera repetición en el clon no encontró benchmark-busqueda.json por su ruta relativa; se reprodujo el archivo histórico dentro del directorio temporal y luego las 35 pruebas pasaron. No se modificó el benchmark original ni se importaron filas en PostgreSQL.

## Build backend

Resultado: PASS, exit code 0 con pnpm build en el clon y en el backend activo. El build activo reemplazó la salida parcial anterior en dist; la salida previa está preservada en el backup.

## Docker

Docker Desktop sigue sin instalar. Winget reconoce el paquete pero no ofrece un instalador aplicable al alcance de usuario. El intento de ejecutar el EXE oficial en modo per-user fue rechazado por la política del ejecutor con el mensaje blocked by policy; el archivo no se descargó ni ejecutó. La instalación per-user está documentada por Docker, pero habilitar WSL2 por primera vez requiere elevación y puede requerir reiniciar Windows.

Referencias: [instalación Docker Desktop en Windows](https://docs.docker.com/desktop/setup/install/windows-install/) y [requisitos de permisos](https://docs.docker.com/desktop/setup/install/windows-permission-requirements/).

## PostgreSQL local

Resultado: NO INICIADO. No hay Docker CLI, servicio PostgreSQL, cliente psql ni listener en los puertos 5432/55432. La configuración docker-compose.dev.yml conserva el tag PostgreSQL 16 y el bind a 127.0.0.1:55432, pero no pudo validarse con Compose. Sentencias cargadas: 0. Sumarios cargados: 0.

No se conectó producción, base remota, Digesto, CIJ, CSJN ni Lex100. No se aplicaron migraciones ni se importó MicroISIS.

## Estado final

ENTORNO BACKEND RECUPERADO / DOCKER Y POSTGRESQL PENDIENTES.

El backend ahora tiene instalación pnpm reproducible, Prisma Client generado, 35 tests verdes y build exit code 0. El trabajo puede continuar en la capa de búsqueda sin el bloqueo de dependencias. El spike PostgreSQL, la fixture y el benchmark contra PostgreSQL continúan bloqueados por la habilitación de Docker/WSL2.

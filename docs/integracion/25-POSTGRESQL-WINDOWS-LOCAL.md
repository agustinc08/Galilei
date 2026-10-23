# PostgreSQL 16 nativo en Windows — estado local

## Decisión y alcance

La Misión 5.2 requiere PostgreSQL 16 nativo, sólo para desarrollo, con puerto preferido `55432`. Docker, WSL y bases institucionales/remotas quedan fuera. No se instala PostgreSQL 17/18 ni se reutiliza una instancia desconocida.

## Inspección realizada el 2026-10-07

- Windows 11 Home, build 26300, x64; sesión sin privilegios administrativos.
- `Get-Service '*postgres*'`: no se encontraron servicios.
- `Get-Command psql`: no se encontró `psql`.
- `C:\Program Files\PostgreSQL\`: no existe.
- No hay listeners en 5432 ni 55432.
- La consulta de catálogo WinGet requirió interacción con el acuerdo de Microsoft Store y no completó; se consultó el origen `winget` explícitamente después.
- No se descargó ni ejecutó instalador alguno. No se creó servicio, rol, base, archivo `.env` ni conexión.

La inspección de WinGet identificó PostgreSQL 16.15-5 publicado por PostgreSQL Global Development Group mediante el instalador EDB, SHA-256 `4065dbc5ffb52010e7357dfd6a74934878f1c6faf7a75cad1411a22e11b7b929`. La documentación de EDB indica que el instalador requiere permisos de administrador. Como el proceso actual no puede elevar, la instalación queda para ejecución humana. No se intentó eludir esa restricción.

Fuentes oficiales: [descargas de PostgreSQL para Windows](https://www.postgresql.org/download/windows/), [guía EDB de instalación para Windows](https://www.enterprisedb.com/docs/supported-open-source/postgresql/installing/windows/) y [guía EDB para desarrollo/pruebas](https://www.enterprisedb.com/docs/dev-guides/deploy/windows/).

## HUMAN RUN — POWERSHELL COMO ADMINISTRADOR

Abrí PowerShell con **Ejecutar como administrador** y ejecutá el siguiente bloque. Descarga el instalador oficial EDB, verifica el hash publicado por el manifiesto oficial WinGet y abre el asistente interactivo; no incorpora la contraseña en argumentos ni imprime secretos.

```powershell
$installer = Join-Path $env:TEMP 'postgresql-16.15-5-windows-x64.exe'
Invoke-WebRequest -Uri 'https://get.enterprisedb.com/postgresql/postgresql-16.15-5-windows-x64.exe' -OutFile $installer
$expected = '4065dbc5ffb52010e7357dfd6a74934878f1c6faf7a75cad1411a22e11b7b929'
$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $installer).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw "SHA-256 no coincide: $actual" }
Start-Process -FilePath $installer -Wait
```

En el asistente:

1. Instalá PostgreSQL Server 16 y Command Line Tools (`psql`, `pg_dump`). pgAdmin es opcional; omití Stack Builder y componentes extra.
2. Conservá la carpeta predeterminada `C:\Program Files\PostgreSQL\16` salvo que tengas una razón para cambiarla.
3. Configurá el puerto `55432`.
4. Elegí una contraseña nueva, fuerte y exclusiva para el superusuario local `postgres`. No reutilices claves institucionales y no la compartas en el chat ni la guardes en el repositorio.
5. Si el asistente ofrece aceptar conexiones remotas, dejá sólo loopback/local.

Al terminar, en PowerShell comprobá servicio, binario y listener:

```powershell
Get-Service '*postgres*'
& 'C:\Program Files\PostgreSQL\16\bin\psql.exe' --version
Get-NetTCPConnection -State Listen -LocalPort 55432 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

Si el servicio no está `Running`, `psql` no está en la ruta indicada, el puerto es distinto, o la dirección de escucha no es loopback, detené el avance y registrá la salida no sensible. No cambies una instancia preexistente sin identificarla.

### Crear el rol y la base DEV

Sólo después de confirmar que el listener pertenece a la instalación local recién creada, abrí `psql` con solicitud interactiva de contraseña:

```powershell
& 'C:\Program Files\PostgreSQL\16\bin\psql.exe' -h 127.0.0.1 -p 55432 -U postgres -d postgres -W
```

En `psql`, creá rol sin privilegios globales y contraseña mediante el prompt seguro; luego creá la base:

```sql
CREATE ROLE bjc_dev LOGIN;
\password bjc_dev
CREATE DATABASE buscador_juridico_civil_dev OWNER bjc_dev;
\connect buscador_juridico_civil_dev bjc_dev
SELECT version();
SELECT current_database();
SELECT current_user;
```

La clave ingresada con `\password` no aparece en el historial SQL. No uses `PASSWORD '...'` literal. Conservá la credencial localmente en un gestor de contraseñas. Para que el trabajo automatizado continúe, informá sólo que la instancia está instalada y el rol/base fueron creados; nunca envíes la clave.

## Aislamiento de Prisma

Antes de cualquier operación que escriba, la conexión deberá apuntar a `127.0.0.1:55432` y a `buscador_juridico_civil_dev`. No sobrescribir `.env`. El backend usa Prisma 7 con `prisma.config.ts` y `dotenv/config`; antes de adoptar `.env.development.local` debe verificarse cómo cargarlo realmente. No guardes secretos en Git ni en logs. No ejecutar `migrate`, `db push`, seed o importación hasta demostrar host, puerto, nombre de base y usuario DEV.

Tras instalar, primero inspeccionar de nuevo servicio/listener y probar autenticación interactiva de `bjc_dev`; luego comprobar `SELECT version(), current_database(), current_user`. Aplicar sólo las migraciones existentes del proyecto y únicamente a esa base DEV. La migración actual solicita `pg_trgm`; PostgreSQL 16 documenta `pg_trgm` como extensión confiable, instalable por el propietario con privilegio `CREATE` en la base: [pg_trgm](https://www.postgresql.org/docs/16/pgtrgm.html) y [CREATE EXTENSION](https://www.postgresql.org/docs/16/extend-extensions.html).

## Control del servicio

Una vez instalado, el nombre exacto depende del servicio que haya creado el instalador. Identificalo con `Get-Service '*postgres*'`. Para detener o iniciar posteriormente, sustituí `<nombre-servicio>` por el nombre verificado:

```powershell
Stop-Service -Name '<nombre-servicio>'
Start-Service -Name '<nombre-servicio>'
```

No detenerlo al concluir la misión sin una necesidad explícita.

## Estado de esta misión

PostgreSQL no instalado; servicio, listener, rol y DB DEV no existen; Prisma no migrado; fixture no importada. Este documento registra el procedimiento y el bloqueo, no una instalación realizada. El adaptador PostgreSQL y las pruebas que requieren DB quedan condicionados a completar `HUMAN RUN` y demostrar la conexión local.

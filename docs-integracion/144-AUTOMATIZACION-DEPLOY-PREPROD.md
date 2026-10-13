# 144 — Automatización y operación de deploy preprod

**Estado:** preparada, no ejecutada; no existe target institucional al corte. Todos los comandos DB requieren configuración y aprobación preprod explícitas. No se deben ejecutar en DEV como ensayo.

## Guardas y comandos disponibles

Desde `C:\proyecto triple\JurisprudenciaN\back`, con variables cargadas desde el vault institucional y storage existente:

```powershell
node scripts/with-preprod-db-guard.cjs check
node scripts/with-preprod-db-guard.cjs target-verify
node scripts/with-preprod-db-guard.cjs migrate-status
node scripts/with-preprod-db-guard.cjs migrate-deploy
node scripts/with-preprod-db-guard.cjs db-report
node scripts/with-preprod-db-guard.cjs projection-verify
node scripts/with-preprod-db-guard.cjs projection-rebuild
node scripts/with-preprod-db-guard.cjs projection-repair
```

`check` no abre conexión. Las demás acciones validan primero `NODE_ENV=production`, `BJC_DEPLOYMENT_ENV=preprod`, aprobación explícita, DB/rol coincidentes, HTTPS, JWT, storage aislado y límites de runtime. Toda acción conectante ejecuta antes `target-verify`, que comprueba DB, rol, puerto y dirección efectiva PostgreSQL, y aborta ante loopback. No ejecutar el script de proyección DEV.

## Secuencia automatizada

`scripts/deploy-preprod.ps1` compila el validador, hace `check`, verifica hashes del backup aprobado, consulta migraciones, aplica migraciones explícitas, construye backend/frontend, llama al script institucional de inicio, espera readiness, verifica la proyección y corre el smoke de Playwright. El script del service manager se entrega por host; no se inventa un método universal de Windows/Linux.

Para producir el manifiesto de backup en un host Windows aprobado, el operador carga `PGPASSFILE` desde el vault (archivo ACL restringido, nunca contenido en comando/chat) y PostgreSQL client tools en PATH, y ejecuta contra un directorio de salida nuevo fuera del storage:

```powershell
& '.\scripts\backup-preprod.ps1' -OutputDirectory '<directorio-nuevo-backup>'
```

El script corre `check` y `target-verify`, crea dump custom con `pg_dump --no-password`, valida el archivo con `pg_restore --list`, crea snapshot de lectura del storage con `tar`, valida el archive y escribe SHA-256/`backup-manifest.json`. No modifica los originales. Si la plataforma aprobada es Linux u otra, infraestructura debe usar herramienta equivalente y entregar el mismo manifiesto/verificación antes de deploy.

Formato mínimo del manifiesto de backup que recibe el deploy script:

```json
{
  "verification": "PASS",
  "target": {
    "host": "<fqdn-preprod>", "port": 5432,
    "database": "buscador_juridico_civil_preprod", "role": "<rol-preprod>"
  },
  "databaseBackup": { "path": "<ruta del dump aprobado>", "sha256": "<64 hex>" },
  "storageBackup": { "path": "<ruta del archivo/paquete aprobado>", "sha256": "<64 hex>" }
}
```

Infraestructura genera esos archivos con su herramienta aprobada; el script valida existencia y SHA-256 antes de migrar. El manifiesto no debe contener URL de conexión ni secretos. Uso futuro:

```powershell
$env:NODE_ENV = 'production'
$env:BJC_DEPLOYMENT_ENV = 'preprod'
$env:BJC_PREPROD_DATABASE_APPROVED = 'true'
& '.\scripts\deploy-preprod.ps1' `
  -BackupManifestPath '<backup-verificado.json>' `
  -ServiceStartScript '<inicio-aprobado-por-infra.ps1>' `
  -ReleaseManifestPath '<destino-nuevo>\release-manifest.json'
```

Los restantes valores se inyectan desde el vault y no se guardan en el repositorio. El preflight aborta si DB apunta a DEV/loopback, falta storage o no coinciden target/manifest. `migrate deploy` no ocurre al iniciar Nest.

Antes de iniciar debe cargarse también `BJC_PREPROD_API_ORIGIN`, `BJC_PREPROD_FRONTEND_ORIGIN`, `BJC_PREPROD_SMOKE_EMAIL`, `BJC_PREPROD_SMOKE_PASSWORD`, `BJC_PREPROD_SMOKE_DOCUMENT_ID`, `BJC_RELEASE_ID`, `BJC_BACKEND_BUILD_ID`, `BJC_FRONTEND_BUILD_ID` y una ruta absoluta/nueva `BJC_PREPROD_REPORT_PATH`. El script los valida antes de tocar migraciones; cuenta/password/document ID deben corresponder a una cuenta y documento aprobados por el owner.

## Bootstrap del corpus y proyección

DB vacía → migraciones revisadas → usuarios UAT sólo por owner de identidad → modalidad de corpus aprobada (A completo, B subset o C fixtures) → import autorizado/dry-run → manifest (document/file count, bytes, SHA-256, source, timestamp) → `projection-rebuild` si está justificado → `projection-verify` → smoke. No copiar corpus ahora; mantener raíces fuente read-only y derivados content-addressed. No iniciar rebuild automáticamente con la aplicación.

## Smoke y reporte

`front/playwright.preprod.config.ts` requiere origins HTTPS no loopback, marcadores preprod/aprobación, cuenta institucional de smoke, ID de documento aprobado, release/build IDs y ruta absoluta nueva para el reporte. Ejecutar:

```powershell
pnpm exec playwright test --config=playwright.preprod.config.ts
```

El smoke comprueba readiness, login, TERM/PHRASE/PREFIX/SUFFIX/SHORT/AND/OR/NOT, apertura del ID autorizado, HTTP Range 206 y logout. El JSON registra environment, release/build, migraciones, conteos de corpus/proyección, estado health, latencias por familia y errores sin query, cuerpo, título ni credenciales. Requiere acceso al DB-report mediante la guarda preprod.

Carga de 1/5/10 usuarios: planificada y **no ejecutada**; acordar ventana, límites y SLO antes de correrla. Guardar p50/p95, errores y host/capacidad con el acceptance report.

Harness preparado, separado del deploy estándar (`front/scripts/preprod-load-smoke.mjs`). Sólo después de autorizar ventana, cuenta de carga y límite institucional, cargar `BJC_PREPROD_LOAD_APPROVED=true`, `BJC_PREPROD_LOAD_EMAIL/PASSWORD` desde el vault, usar una nueva ruta `BJC_PREPROD_REPORT_PATH` y ejecutar desde `JurisprudenciaN\front`:

```powershell
pnpm exec node scripts/preprod-load-smoke.mjs
```

Envía una consulta común por cliente concurrente en olas de 1, 5 y 10, mide p50/p95 y errores y persiste un JSON sanitizado. No es carga de certificación ni se ejecuta automáticamente con el deploy.

## Backup, restore y monitoreo

Respaldar DB y storage juntos, registrar SHA-256 y verificar ambos artifacts. Ejecutar restore drill sólo sobre destino temporal aislado con aprobación y registrar RPO/RTO. Sprint 12.1 documenta restore/migration-from-zero aprobados en DB temporales DEV (docs 103–104); no repetir ni restaurar sobre DEV, y esa evidencia no sustituye el restore preprod.

Mínimo operativo: readiness/API, DB, storage, respuestas 5xx, slow Search sin persistir texto de consulta, disco/cuota, backup success/failure y alerta al owner. Infraestructura define dashboard/alertas y retención antes de habilitar UAT; no instalar stack de monitoreo sin host.

## Release y rollback

Release inicial sugerido: `BJC PREPROD RC1`. Registrar version/date, backend/frontend build IDs, commit SHA si disponible, count/status de migraciones y versión/estado de projection. Guardar el acceptance report resultante. Ante regresión de servicio, usar deployment anterior sólo si es compatible; una migración aplicada requiere fix-forward o restore aprobado a DB de reemplazo aislada. No prometer downgrade automático.

Digesto export/crosswalk sigue PENDING hasta recibir paquete institucional autorizado; no consultar endpoint remoto. CIJ/CSJN public mass automated download continúa NO GO.

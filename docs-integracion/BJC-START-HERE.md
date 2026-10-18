# Galilei — inicio rápido

**Actualizado:** 2026-10-18, después de UX-PROMOTE-DEV y PREPROD-FIX-1. `origin/dev=af8f51d6f5e5be48e0167c5890328acd3c80c2c4`; `main` permanece intacta; `integration/galilei-beta` conserva el SHA certificado INT-1R `111bc5c86faff0bf946ef5e199b4463fe8217d5a`. UX está promovida y revisada. La candidata `feature/preprod-uat-fix`, basada en `4d68c49d80642a19e93cc1af799fa78414421309`, endurece guards de infraestructura y todavía requiere publicación/revisión independiente. UAT institucional y preproducción siguen pendientes; no hubo promoción de la candidata a DEV.

## Producto integrado

- **Jurisprudencia:** buscar fallos institucionales publicados. La gestión de borradores, publicación y revisión se muestra según el rol institucional.
- **Mi Sala / Juzgado:** buscar, previsualizar y compartir documentos de las dependencias en las que la persona tiene membresía activa. Con una dependencia se entra directamente; con varias se puede elegir. Sin dependencias se muestra una orientación clara.
- **Mis documentos:** espacio personal global; cada archivo y carpeta pertenece a la persona autenticada y no se vuelve compartido por cambiar de dependencia.

Search, Viewer, archivos descargables, OCR/formats y permisos usan sus contratos de origen. La búsqueda general de Jurisprudencia no incorpora documentos privados de dependencias ni personales. Los roles de Jurisprudencia no conceden acceso a una Sala/Juzgado; la membresía documental no concede controles de publicación.

## Estado de INT-1

**INT-1R PASS; UX promovida y revisada.** `origin/dev=af8f51d6f5e5be48e0167c5890328acd3c80c2c4`; `main` sigue intacta. `integration/galilei-beta` conserva el SHA certificado INT-1R `111bc5c86faff0bf946ef5e199b4463fe8217d5a`. Search v3 continúa como índice derivado exacto (69.313/69.313), PostgreSQL como source of truth; Prisma registra 31/31 migraciones. UAT y preproducción siguen pendientes; `feature/preprod-uat-prep` prepara esos gates sin desplegar.

## Rutas principales

- `/galilei` — inicio compacto y selector de los tres universos.
- `/jurisprudencia` — consulta de fallos publicados y acceso de operador a su flujo.
- `/spaces` — documentos de Mi Sala / Juzgado; la selección de dependencia depende de las membresías activas.
- `/personal` — archivos privados personales.

El menú global aparece para toda sesión autenticada, incluso al navegar por resultados, detalle y Viewer. Las páginas de impresión conservan su formato independiente.

## Lectura técnica

1. `BJC-ESTADO-ACTUAL.md`, `BJC-DECISIONES-Y-CONTRATOS.md` y `BJC-MAPA-TECNICO.md`.
2. `BJC-FUNCIONAL.md`, `BJC-ROADMAP.md`, `BJC-SEARCH.md` y `BJC-ESPACIOS-DOCUMENTALES.md`.
3. `BJC-OPERACION-JURISPRUDENCIA.md`, `BJC-CERTIFICACION-CORPUS-CIVIL.md` y `BJC-CERTIFICACION-SEARCH-VIEWER.md`.
4. `BJC-FUENTES-DOCUMENTALES.md`, `BJC-PROCESAMIENTO-DOCUMENTAL.md`, `BJC-UX-JURISPRUDENCIA.md` y `BJC-UX-ESPACIOS-DOCUMENTALES.md`.
5. Preparación operativa vigente: `136-RUNBOOK-DEPLOY-PREPROD.md`, `134-OPERACION-Y-MONITOREO-PREPROD.md`, `141-PAQUETE-UAT-INSTITUCIONAL.md` y checklist `143-PREPROD-BOOTSTRAP-CHECKLIST.md`.

## Límites del entorno

El trabajo de integración y pruebas de escritura usa exclusivamente PostgreSQL DEV local en `127.0.0.1:55432`. No conectar a producción o servidores institucionales. Una base temporal de migración debe tener nombre único, estar en esa misma instancia y borrarse sólo después de guardar evidencia. UAT humana, UNC institucional, preproducción y producción requieren sus gates separados.

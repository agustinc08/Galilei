# Galilei — inicio rápido

**Actualizado:** 2026-10-18, INT-1R. Dictamen: PASS en `integration/galilei-beta`, lista para promoción separada a DEV. INT-1R no modificó `origin/dev`, `main` ni ramas UX; UAT institucional y preproducción siguen pendientes.

## Producto integrado

- **Jurisprudencia:** buscar fallos institucionales publicados. La gestión de borradores, publicación y revisión se muestra según el rol institucional.
- **Mi Sala / Juzgado:** buscar, previsualizar y compartir documentos de las dependencias en las que la persona tiene membresía activa. Con una dependencia se entra directamente; con varias se puede elegir. Sin dependencias se muestra una orientación clara.
- **Mis documentos:** espacio personal global; cada archivo y carpeta pertenece a la persona autenticada y no se vuelve compartido por cambiar de dependencia.

Search, Viewer, archivos descargables, OCR/formats y permisos usan sus contratos de origen. La búsqueda general de Jurisprudencia no incorpora documentos privados de dependencias ni personales. Los roles de Jurisprudencia no conceden acceso a una Sala/Juzgado; la membresía documental no concede controles de publicación.

## Estado de INT-1

**PASS local tras INT-1R.** Alias Search v3 activo y exacto (69.313/69.313); 6.014 Sentencias publicadas y 56 del subconjunto civil J9 permanecen en revisión. Prisma registra 31/31 migraciones; el replay de 31 migraciones se reutiliza por hash desde un clúster PostgreSQL 16 aislado ya probado. Backend/frontend tests, typechecks y builds pasan; la rama está lista para una promoción posterior. UAT, preproducción y producción siguen pendientes.

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

## Límites del entorno

El trabajo de integración y pruebas de escritura usa exclusivamente PostgreSQL DEV local en `127.0.0.1:55432`. No conectar a producción o servidores institucionales. Una base temporal de migración debe tener nombre único, estar en esa misma instancia y borrarse sólo después de guardar evidencia. UAT humana, UNC institucional, preproducción y producción requieren sus gates separados.

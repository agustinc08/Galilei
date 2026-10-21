# Galilei — inicio rápido

**Corte operativo: 2026-10-21.** PC principal `AgustinNotebook`; raíz `C:\proyecto triple`. `origin/dev` está consolidado con Copernic en `899210c0c9f2231fd9302b1c86971b23a7a19610`, más el follow-up documental de esta misión. `main` permanece en `83947656420a9d6f6c3cfb12b353eb7f2c293a28`.

## Estado actual

- **Search:** V4 activo y certificado en OpenSearch 2.19.6 GREEN; plugin `analysis-icu` 2.19.6, ICU4J 75.1, heap 2 GiB. El alias `galilei-search-active` apunta sólo a `galilei-search-v004-20261020t094732495z-6015e394`; V3 se retiene para rollback.
- **Copernic:** integrado y revisado en DEV. Typechecks y builds PASS, 5 E2E enfocados PASS, 27 comprobaciones responsive PASS y limpieza ACL sintética verificada.
- **Oficina:** la próxima misión es `GALILEI-V4-OFFICE-MIGRATE-1`, en Sytec10 y `D:\proyecto triple`. PostgreSQL está READY, OpenSearch no está instalado y la migración V4 todavía no empezó. Esta PC no se tocó durante el cierre de DEV.

## Producto integrado

- **Jurisprudencia:** consultar fallos publicados con Search V4 y filtros/paginación.
- **Mi Sala / Juzgado:** seleccionar una o varias dependencias activas y consultar carpetas/documentos según permisos.
- **Mis documentos:** espacio personal privado de la persona autenticada.
- **Espacios:** visibilidad privada, compartida o restringida; Viewer y descarga mantienen autorización por documento.

La búsqueda pública de smoke respondió 200 para “responsabilidad civil”, frase exacta, “falta de servicio”, Sala A y página 2; 5xx=0, 503=0. La matriz ACL sintética comprobó dueño/no dueño, shared, restricted, denegación sin filtración, Viewer y descarga. No se ejecutaron migraciones en esta integración.

## Rutas principales

- `/galilei` — inicio y selección de destino.
- `/consulta` — búsqueda de jurisprudencia publicada.
- `/spaces` — Mi Sala / Juzgado.
- `/spaces/manage` — carpetas y administración según el rol de dependencia.
- `/personal` — documentos privados personales.

El acceso a contenido privado depende de las autorizaciones del backend; los roles de Jurisprudencia no otorgan membresía documental.

## Lectura técnica

1. `BJC-ESTADO-ACTUAL.md`, `BJC-DECISIONES-Y-CONTRATOS.md` y `BJC-MAPA-TECNICO.md`.
2. `BJC-FUNCIONAL.md`, `BJC-ROADMAP.md`, `BJC-SEARCH.md` y `BJC-ESPACIOS-DOCUMENTALES.md`.
3. Runbooks institucionales de preproducción describen otro entorno. No los uses como configuración de oficina; la migración de Sytec10 tiene su misión y validaciones propias.

## Límites del entorno

El DEV principal usa PostgreSQL `127.0.0.1:55432` y OpenSearch `127.0.0.1:9200`. No conectar a producción ni a servidores institucionales desde este entorno. **La PC de oficina es Sytec10 con raíz `D:\proyecto triple`; su PGDATA no es el PGDATA del equipo principal.** No acceder ni cambiar la oficina hasta ejecutar la misión `GALILEI-V4-OFFICE-MIGRATE-1`.

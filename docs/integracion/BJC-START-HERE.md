## Estado de PC principal — 2026-10-23

El código vigente está organizado en `client/`, `server/` y `docs/`. La app Digesto antigua en `legacy/digesto/` se retiró por no tener dependencias activas; el dominio Digesto vigente sigue integrado en las aplicaciones actuales. La limpieza de raíz parte de `origin/dev=dfa81250af387326ab338b1c58fcc3198c42817a`; `origin/main=83947656420a9d6f6c3cfb12b353eb7f2c293a28` permanece intacta. El commit de QA `2eba98996b4dc6f3ef7438d01e1a1ff31341a220` ya es ancestro de esa base. El worktree candidato conserva cambios locales no committeados y no se modifica en esta limpieza.

# Galilei — inicio rápido

**PC principal:** `AgustinNotebook`; raíz `C:\proyecto triple`. Este documento registra el estado operativo observado el 2026-10-23, no una certificación de oficina ni un permiso para cambiar `main`.

## Estado actual

- **Search principal:** V4 activo y certificado en OpenSearch 2.19.6 GREEN; plugin `analysis-icu` 2.19.6, ICU4J 75.1, heap 2 GiB. El alias `galilei-search-active` apunta sólo a `galilei-search-v004-20261020t094732495z-6015e394`; V3 se retiene para rollback.
- **Release QA aislada:** la certificación exacta de `2eba98996b4dc6f3ef7438d01e1a1ff31341a220` conserva QA local en `127.0.0.1:55434` y OpenSearch `127.0.0.1:29220/29320`. El bootstrap alcanzó `PROJECTED` (69.313 documentos; outbox pending=0, failed=0), pero la review dejó gates de runtime P1 pendientes para lifecycle, concurrencia, Viewer, descarga y ACL. Se preservan esos runtimes hasta cerrar la certificación; no son el Search principal.
- **Copernic:** integrado y revisado en DEV. Typechecks y builds PASS, 5 E2E enfocados PASS, 27 comprobaciones responsive PASS y limpieza ACL sintética verificada.
- **Oficina:** Sytec10 (`D:\proyecto triple`) no fue accedida en esta misión. El paquete local `office-runtime-transfer.rar` es un snapshot de datos con un dump DEV y los blobs de Corpus; no contiene secretos. Usar el código del SHA final de DEV como fuente y revisar el manifiesto/checksums antes del traspaso. No iniciar la migración de oficina hasta ejecutar su misión y sus validaciones propias.

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

## Normalización de estructura — 2026-10-23

El código versionado queda en client/ + server/; documentación en docs/ y la aplicación anterior Digesto en legacy/digesto/. Esta misión partió del release candidate 2eba98996b4dc6f3ef7438d01e1a1ff31341a220, con origin/dev=1ba18d69b548f6cee915478229b9cd168ee0096d y origin/main=83947656420a9d6f6c3cfb12b353eb7f2c293a28 observados al inicio. No se cambiaron PostgreSQL, OpenSearch, corpus ni la aceptación de producto. Ver docs/estructura-proyecto.md y docs/inventario-raiz.md; el estado funcional que sigue corresponde al corte del 2026-10-21.

# Galilei — inicio rápido

**Último corte funcional documentado: 2026-10-21.** PC principal `AgustinNotebook`; raíz `C:\proyecto triple`. `origin/dev=ebefee54a5208187b7f77b84d71d7addd043f653`; el trabajo de bootstrap V4 está sin commit en un worktree candidato aislado y aún no se promovió. `main=83947656420a9d6f6c3cfb12b353eb7f2c293a28` permanece intacta.

## Estado actual

- **Search principal:** V4 activo y certificado en OpenSearch 2.19.6 GREEN; plugin `analysis-icu` 2.19.6, ICU4J 75.1, heap 2 GiB. El alias `galilei-search-active` apunta sólo a `galilei-search-v004-20261020t094732495z-6015e394`; V3 se retiene para rollback.
- **Fresh bootstrap:** `JURISPRUDENCIA-V4-FRESH-BOOTSTRAP-TOOLING-1R` sigue en verificación aislada; el target V4 de prueba está en `PROJECTING`, sin alias. No declarar resuelto el bloqueo de oficina hasta cerrar paridad, pruebas, restart y review independiente.
- **Copernic:** integrado y revisado en DEV. Typechecks y builds PASS, 5 E2E enfocados PASS, 27 comprobaciones responsive PASS y limpieza ACL sintética verificada.
- **Oficina:** el bloqueo `OFFICE_V4_BOOTSTRAP_TOOLING_GAP` sigue abierto. Sytec10 (`D:\proyecto triple`) no fue accedida; PostgreSQL está READY, OpenSearch no está instalado y la migración V4 no empezó. No iniciar allí hasta que el bootstrap fresh sea certificado y promovido.

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

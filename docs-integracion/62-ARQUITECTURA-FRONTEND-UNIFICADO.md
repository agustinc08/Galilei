# Arquitectura de la interfaz unificada

**Sprint 9 — 2026-10-08.** Estado: implementado en DEV; ver límites en el informe 70.

## Navegación

AdminShell conserva las pantallas y APIs de Jurisprudencia y monta una navegación única para búsqueda, jurisprudencia, Digesto, documentos del Corpus, revisión, estado, consulta pública, perfil y logs administrativos (sólo ADMIN). Las rutas /busqueda y /jurisprudencia redirigen a pantallas existentes; /documentos dirige a /corpus. No se duplican los PDF para compartir dominios.

## Pantallas nuevas o extendidas

- /digesto: administración de colecciones, temas y etiquetas.
- /digesto/[id]: lista paginada de documentos asociados y acceso al visor.
- /revision: cola paginada de asociaciones y clasificaciones sugeridas.
- /corpus/[id]: visor/procedencia y panel separado para revisión editorial, asociación, clasificación, Digesto y auditoría.
- /busqueda-avanzada: búsqueda existente con metadatos de colecciones/temas/etiquetas Digesto como contexto de resultados Corpus.

Las rutas compilan con Next.js. La autorización efectiva reside en backend; la UI no sustituye ACL.

## Límites

Las páginas de Digesto son catálogo curado sobre documentos Corpus; no importan el Digesto institucional legacy ni ejecutan búsqueda independiente con su ACL. Las pestañas de consulta pública siguen siendo el sistema Jurisprudencia existente. No se verificó un flujo autenticado en navegador porque no hay usuarios DEV activos ni credenciales de aceptación. El visor conserva PDF nativo, fragmento, página y anterior/siguiente; no pinta resaltados sobre el PDF. Véase 68 y 70.

# 59 — Frontend de búsqueda y visor de Corpus

## Rutas y componentes

- `JurisprudenciaN/front/src/app/(admin)/busqueda-avanzada/page.tsx`: resultados federados Corpus con snippet, fuente y enlace “Abrir documento” que transmite consulta y página.
- `JurisprudenciaN/front/src/app/(admin)/corpus/page.tsx`: panel de administración con totales/run/cola de revisión; filtros unresolved, candidate, sin clasificación, OCR, fallo y metadata faltante.
- `JurisprudenciaN/front/src/app/(admin)/corpus/[id]/page.tsx`: visor, procedencia/metadata, búsqueda dentro del documento, contextos de coincidencia, anterior/siguiente, página y descarga autenticada.
- `corpus.module.css`, `viewer.module.css`, `AdminShell.tsx` y `src/types/busqueda.ts`: estilos, acceso en navegación y tipos de búsqueda federada.

## Acciones verificadas por código y smoke

El visor carga el PDF por endpoint autenticado, usa el control `#page=N` del visor nativo del navegador, ofrece descarga como blob autenticado, navega matches y muestra su contexto/página. El smoke real probó resultado/snippet, página 1, match, archivo de 76.578 bytes y checksum. El build de Next generó `/corpus`, `/corpus/[id]` y `/busqueda-avanzada`.

## Limitaciones actuales

- El navegador embebido lleva a la página, pero no pinta resaltado sobre el texto dentro del PDF. La coincidencia aparece en el panel lateral con contexto.
- No hay visor PDF.js ni capa de anotaciones.
- La cola de revisión es de lectura y filtrado; aprobar/rechazar asociación o clasificación y acciones por lote aún no están disponibles.
- No se implementó comparación visual de duplicados, merge, selección jurisprudencial con motivo, ni acciones Digesto.
- No se hizo captura funcional autenticada en navegador; la evidencia es build + smoke backend de metadata/archivo/matches. El producto sigue tras autenticación admin/operator.

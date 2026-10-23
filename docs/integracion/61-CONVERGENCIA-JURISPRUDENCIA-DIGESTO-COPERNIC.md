# 61 — Convergencia Jurisprudencia, Digesto, Corpus y Copernic

**Sprint 9 · 2026-10-08 · Alcance: DEV.** Esta decisión antecede los cambios de implementación y se basa en los sistemas y documentos locales disponibles.

## Jurisprudencia

- **Conservado:** `Sentencia`, `Sumario`, Salas, tipos de fallo, tribunales, usuarios/roles, estados de carga/publicación, referencias y bitácora `AccionLog`. Es el dueño del contenido jurídico editorial.
- **Adaptado:** las sentencias conservan su identidad. El Corpus se vincula por `CorpusDocumentLink` cuando existe una relación revisada; selección y publicación siguen siendo decisiones editoriales distintas. Los permisos existentes son `ADMIN` y `OPERADOR`; esta integración no inventa roles nuevos.
- **Descartado:** crear sentencias duplicadas sólo para dar identidad a un PDF, tratar una sugerencia como vínculo confirmado o convertir texto extraído en sumario jurídico.

## Digesto

- **Conservado:** el modelo legado describe `Doc`, `Tipo`, `Dependencia` y `DocDependencias`; cada documento admite jerarquía (`idDocAsociado`), texto PDF, fecha, voz/términos y estado pendiente. La interfaz muestra búsqueda, filtros, tabla y gestión por tipo/dependencias.
- **Adaptado:** colecciones, temas y etiquetas pasan a ser metadatos relacionales en el backend moderno; se vinculan a `CorpusDocument` mediante relaciones y un `CorpusDocumentLink`, sin copia del archivo. Los nombres de entidad legado no se convierten automáticamente en una taxonomía aprobada. Los datos del Digesto viven en una base remota separada y no hay un export local autorizado/verificable en este workspace, así que Sprint 9 no migra sus filas ni los 278 PDF.
- **Descartado:** frontend React separado, URLs/API institucionales codificadas en el cliente, almacenamiento `pdfContent` como una copia por documento y borrado en cascada de archivos al quitar una relación.

## Copernic

- **Conceptos incorporados:** una caja de búsqueda principal, texto completo, snippets cortos, filtros, vista previa, apertura directa, página de coincidencia, navegación anterior/siguiente y búsqueda interna del documento.
- **Descartado:** ejecutar o integrar binarios Copernic como motor, indexador o fuente de datos. En el workspace sólo hay instaladores; no se encontró una configuración o índice exportable.

## Corpus

Corpus conserva el archivo content-addressed, checksum, procedencia, extracción/páginas, estado de OCR e identidad de bytes. Es la representación física única del PDF en la aplicación moderna. No reemplaza la sentencia ni asume ownership editorial del Digesto. El acceso sigue aplicando ACL y el estado `PUBLIC` no se concede por ingesta o relación.

## Fuentes funcionales inspeccionadas

- Backend moderno: Prisma `Sentencia`, `Sumario`, `Usuario`, `Rol`, `AccionLog` y entidades `Corpus*`; módulos Nest de Corpus/Jurisprudencia.
- Digesto legacy: esquema Prisma con `Doc`, `Tipo`, `Dependencia`, `DocDependencias`; React con pestañas, búsqueda, filtros, tabla y edición. Su cliente apunta a `https://cncivil04.pjn.gov.ar/api/...`; no se llamó a ese endpoint.
- Copernic: sólo instaladores x86/x64 locales; no se encontró índice o setup.
- Roles modernos: `ADMIN` y `OPERADOR`. Mapeo UI inicial: ambos pueden consultar y revisar Corpus; sólo `ADMIN` administra catálogos, roles y configuración. Cualquier política más fina requiere una definición institucional.

## Decisión de frontend

Un solo Next.js en `client`. “Documentos” es el rótulo orientado a usuarios y “Corpus” queda para operaciones técnicas. Búsqueda y lectura son comunes; curaduría usa las entidades existentes y sus permisos. Digesto se incorpora como organización sobre el archivo común, sin consumir la base remota legacy.

## Límites de Sprint 9

No hay crosswalk confirmado entre los documentos legacy Digesto y el inventario moderno. Por eso una integración end-to-end con contenido Digesto real queda pendiente de recibir un paquete/export autorizado. Este límite no habilita scraping, acceso remoto, ni importación de los PDF de administración del servidor legacy. OCR depende de herramientas locales comprobables; scan incremental se implementará sólo con los roots DEV declarados y en modo read-only.

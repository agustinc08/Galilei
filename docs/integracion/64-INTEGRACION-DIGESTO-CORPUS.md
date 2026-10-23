# Integración Digesto — Corpus

**Sprint 9 — catálogo funcional de desarrollo, sin importación del dominio legacy.**

El esquema añadido permite crear DigestoCollection, DigestoTopic y DigestoTag, asociarlos a un CorpusDocument y retirarlos sin copiar, mover ni modificar el PDF original. La vista de colección pagina documentos y enlaza al visor. La búsqueda Corpus incorpora nombres de colecciones, temas y etiquetas como metadata del resultado y presenta indicación Digesto.

## Frontera de datos

El Digesto legacy usa entidades y permisos propios (Doc, Tipo, Dependencia, DocDependencias, idDocAsociado) y un endpoint institucional fijado en el cliente histórico. Los 278 PDFs locales del servidor Digesto están excluidos del inventario institucional Corpus. No se consultó el endpoint, ni se importaron PDFs/metadatos, ni se creó crosswalk de ACL o identidad. crossDomainLinks persiste vacío. No hay base suficiente para equiparar IDs o dominios.

Por tanto, la unificación es funcional y visual para taxonomía Corpus en DEV, no una fusión de datos con el Digesto real. Falta export autorizado, mapeo institucional de ACL/identidad y validación de búsqueda y permisos del Digesto. Sin ello, no se habilita búsqueda de contenido legacy ni publicación.

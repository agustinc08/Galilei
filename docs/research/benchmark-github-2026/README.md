# Benchmark de producto jurídico y búsqueda — GitHub 2026

**Fecha de corte:** 25-10-2026. **Alcance:** investigación y roadmap; sin implementación.

## Resumen ejecutivo

Se revisaron 35 repositorios en cuatro grupos: producto jurídico/citación; fuentes argentinas y prototipos legales; gestión documental e investigación; búsqueda, extracción y OCR. Las referencias de producto más maduras son CourtListener, Paperless-ngx, Zotero, DSpace e InvenioRDM. Para patrones de citación son útiles eyecite y OpenCaseLaw. Los ejemplos argentinos legal-rag (STJ Río Negro) y RAG_CSJN_AI_ENG son prototipos acotados, no evidencia de que un sistema generativo esté listo para producción. mcp-legal-ar descubre fuentes y conectores, pero su licencia publicada excluye el uso comercial sin autorización escrita.

Galilei ya reúne capacidades que muchos referentes no combinan: jurisprudencia civil con filtros, búsqueda determinista sobre OpenSearch, PDFs, referencias curatoriales, estadísticas y espacios privados con ACL. Las oportunidades de mayor valor consisten en conectar lo que ya existe: guardar una búsqueda pública con todos sus filtros, coleccionar fallos con notas, copiar citas estructuradas, explicar qué parte coincide y añadir procedencia verificable.

**No se recomienda reemplazar OpenSearch ni alterar la búsqueda determinista.** Cualquier modo semántico sería optativo, separado, medido sobre consultas civiles argentinas y sujeto a evidencia visible y controles de permisos.

## Alcance y método

- Se examinaron repositorios, README, documentación, licencias, releases y páginas oficiales. Enlaces directos y límites de verificación: [Fuentes](sources.md).
- Estrellas, forks y último push son una instantánea de metadatos públicos de GitHub al 25-10-2026; pueden cambiar y no equivalen a madurez.
- Los tamaños de corpus y resultados de evaluación se identifican como autodeclarados salvo auditoría independiente citada. No se ejecutó código externo.
- Sólo se cuentan capacidades explícitas en fuente/documentación; lo no comprobado se marca desconocido.
- La revisión local fue de código de UI, inventario UAT y guía de usuario. No se consultaron servicios ni datos, ni se repitió QA.
- No se alteraron código, DEV, DB, Search, Sytec10 ni configuración de producto. Los artefactos de esta misión viven únicamente en este directorio.

## Base de comparación de Galilei

Arquitectura informada: React/Vite/TypeScript, NestJS/Prisma, PostgreSQL y OpenSearch 2.19.6. Corpus principal informado: 69.313 documentos; Search V4 activo, V3 rollback. Se preserva el contrato establecido:

- texto sin comillas = prefijo léxico;
- palabra entre comillas = palabra exacta;
- frase entre comillas = frase léxica exacta;
- tolerancia a acentos, «ñ» distinta de «n»;
- búsqueda sin distinción de mayúsculas;
- extensión de prefijo con «%»;
- filtros, campos y operadores existentes.

La consulta pública ya ofrece filtros, orden, páginas, chips activos, URL de consulta, resaltado, selección para imprimir y disponibilidad de PDF. Hay páginas públicas de fallos, favoritos, búsquedas guardadas, estadísticas y espacios. La búsqueda guardada actual no está integrada aún con la página pública: su UI trabaja con JSON de filtros y ruta interna. Las citas y referencias disponibles son curatoriales/manuales, no un citador automático completo ni un indicador de vigencia. El visor PDF público usa búsqueda nativa del navegador; las capacidades de navegación de coincidencias del visor de corpus son otra superficie. UAT_READY tampoco certifica cada acción de negocio.

## Recomendación

Después de la aceptación UAT, priorizar continuidad de investigación: guardar desde consulta pública, guardar un fallo en favoritos/colección, notas privadas y cita copiable con URL y fuente. En paralelo, especificar un registro de procedencia para citas. Mantener IA y grafo doctrinal en fases posteriores, con evaluación humana y fuente rastreable. No enviar consultas o documentos privados a proveedores externos.

## Índice

- [35 proyectos revisados](projects-reviewed.md)
- [Matriz de capacidades](feature-matrix.md)
- [Ideas de búsqueda](search-ideas.md)
- [Investigación jurídica](legal-research-ideas.md)
- [Ideas UX](ux-ideas.md)
- [IA y semántica](ai-semantic-ideas.md)
- [10 quick wins](quick-wins.md)
- [Roadmap](roadmap.md)
- [No recomendado](not-recommended.md)
- [Fuentes](sources.md)
## Top 5 por área de producto

Listas de producto derivadas del ranking de ideas; el orden indica valor y secuencia, no implementación aprobada.

### Cinco momentos WOW
1. Guardar una búsqueda completa y restaurarla igual (Q01).
2. Copiar una cita confiable con fuente y URL (Q02).
3. Coleccionar fallos con notas sin duplicar documentos (Q09).
4. Ver citas entrantes/salientes con evidencia y estado de verificación (Q12/Q13).
5. Comparar pasajes y volver al fallo con página y consulta preservadas (Q18).

### Cinco mejoras de Search
1. Guardar/restaurar consulta pública (Q01).
2. Hacer visible prefijo/palabra/frase y alcance de campo (Q06).
3. Evaluar relevancia civil con set de consultas revisado (Q14).
4. Alertas opt-in con permisos (Q11).
5. Plantillas de búsqueda civil revisadas por abogados (Q25).

### Cinco mejoras del visor
1. Navegación de coincidencias indexadas diferenciada de búsqueda nativa del navegador (Q08).
2. Cita copiable con página/fuente/URL cuando estén disponibles (Q02).
3. Distinguir texto completo, sumario, OCR y PDF (Q07).
4. Comparar fallos y pasajes citados en paralelo (Q18).
5. Preservar posición, filtros y consulta al ir y volver de un documento.

### Cinco mejoras de jurisprudencia
1. Extracción de citas con candidatos y revisión (Q13).
2. Grafo cita/citado por con procedencia (Q12).
3. Historial de fuente, versión y correcciones del corpus (Q17).
4. Cronología explicable de relaciones entre decisiones (Q19).
5. Plantillas por problemas civiles argentinos, sujetas a validación jurídica (Q25).

### Cinco mejoras de espacios de trabajo
1. Colecciones con notas y etiquetas, heredando ACL (Q09).
2. Búsquedas guardadas ligadas a un ámbito (Q01).
3. Alertas opt-in filtradas por ACL antes de enviar (Q11).
4. Compartir colección con audiencia explícita (Q20).
5. Buscar dentro de uno o más espacios sólo cuando todos los conteos, snippets y documentos aplican fail-closed (Q21).

### Cinco mejoras de administración/calidad de datos
1. Procedencia, versiones y aprobaciones de correcciones (Q17).
2. Cobertura por fuente/Sala/año con denominadores visibles (Q23).
3. Cola de citas candidatas revisables (Q13).
4. Revisión de duplicados/versiones, sin borrar automáticamente (Q24).
5. Dataset de relevancia/contrato y análisis de no-regresión (Q14).

## Propuestas diferenciadas por tema

- **Semántica:** Q15, experimento opcional y apagable; no altera resultados exactos.
- **Grafo de citas:** Q12/Q13, empezar con relaciones verificadas y estados pendientes.
- **Investigación guardada:** Q01/Q09, reunir consulta, fallo, colección, nota y vuelta a la fuente.
- **Analytics:** Q22/Q23; favorecer métricas agregadas de calidad, sin almacenar consulta libre por defecto.
- **IA/RAG:** Q16 diferido hasta verificación de cada afirmación, pruebas de privacidad e inyección y revisión profesional.
- **Argentina:** Q14/Q25 con vocabulario, formatos de expedientes, épocas, Salas, materia civil y validación local.
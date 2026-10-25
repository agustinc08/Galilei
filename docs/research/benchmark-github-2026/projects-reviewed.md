# Proyectos revisados

**Metadatos GitHub consultados:** 25-10-2026. Estrellas/forks son aproximados de esa instantánea y cambian; no miden calidad. Las cifras de corpus/evaluación se marcan **autodeclaradas**. “Madurez” es lectura de señales públicas del repo, no auditoría de seguridad o disponibilidad.

## A. Jurisprudencia, derecho y citación

### 1. Free Law Project — CourtListener
[Repositorio](https://github.com/freelawproject/courtlistener) · AGPL-3.0-or-later según LICENSE · 1.052 estrellas / 284 forks · push 2026-10-23.
- **Madurez/stack:** producto de investigación jurídica de EE. UU. establecido; Django/PostgreSQL y servicios de búsqueda/API.
- **Motor/datos/usuario:** búsqueda de opiniones, expedientes PACER, jueces y argumentos; API REST con filtros; abogados, academia, prensa y público. El repositorio describe un archivo amplio; esta revisión no fija un total comparable.
- **Transferir:** filtros, alertas de búsqueda, citas entrantes/salientes, API y navegación de documentos.
- **Límite:** reglas, corpus, PACER, privacidad y licencia no se trasladan sin análisis jurídico; “citado por” no significa precedente vigente.

### 2. OpenCaseLaw
[Repositorio](https://github.com/jonashertner/opencaselaw) · código MIT / datos CC0 declarados · 75 / 16 · push 2026-10-25.
- **Madurez/stack:** proyecto reciente con documentación de auditoría; API/CLI/MCP/Parquet y herramientas para fallos y legislación.
- **Datos/usuario:** el proyecto autodeclara >1 millón de decisiones suizas, ~21.000 normas y ~10 millones de aristas de citas.
- **Transferir:** explicar cómo se cuentan documentos, exponer cobertura frente a precisión y conservar citas pendientes.
- **Límite:** cifras y resolución no son auditoría externa; las reglas y fuentes son suizas.

### 3. fedexx1/legal-rag
[Repositorio y README](https://github.com/fedexx1/legal-rag) · MIT · 0 / 0 · 2 commits; push 2026-09-05.
- **Madurez/stack:** prototipo individual, no sistema productivo; BM25 lematizado+denso, RRF, filtros metadata y generación con API de citas.
- **Datos/usuario:** autodeclara 22.777 fallos del STJ Río Negro (1996–2026), 3.107 sumarios, 20.615 textos completos y 246.465 chunks. Evalúa 50 preguntas/358 afirmaciones y una revisión profesional, según README.
- **Transferir:** preguntas de evaluación locales y verificación exacta de afirmaciones citadas.
- **Límite:** resultados autodeclarados, muestra pequeña, un revisor; no prueba disponibilidad ni calidad de producto institucional.

### 4. giblfiz/llm-law-lib
[Repositorio](https://github.com/giblfiz/llm-law-lib) · licencia estándar no identificada · 1 / 0 · push 2026-10-06.
- **Madurez/stack:** repo muy joven; declara PostgreSQL/pgvector, BM25/ParadeDB, MCP y API.
- **Datos/usuario:** el README autodeclara millones de opiniones, pasajes, secciones normativas y registros de tratamiento en jurisdicciones múltiples; no se comprobó corpus reproducible ni derechos de datos.
- **Transferir:** combinar pasaje, documento y relaciones.
- **Límite:** sin licencia clara ni auditoría de cifras. El proyecto advierte que registros de tratamiento no son una conclusión de “good law”.

### 5. vul-os/molao
[Repositorio](https://github.com/vul-os/molao) · README ofrece MIT o Apache-2.0 · 2 / 0 · push 2026-08-09.
- **Madurez/stack:** etapa 0.1; TypeScript y SQLite FTS5, modo offline/local propuesto.
- **Datos/usuario:** no trae corpus real, demo sintética; diseño de búsqueda de fallos/normas con citas entrantes, salientes y no resueltas.
- **Transferir:** fuente y estado no resuelto explícitos, privacidad local.
- **Límite:** no demuestra ingesta real, precisión ni escala; grafo y recomputación son diseño temprano.

### 6. Probanza-ar/mcp-legal-ar
[Repositorio](https://github.com/Probanza-ar/mcp-legal-ar) · licencia personalizada MCAR · 71 / 24 · push 2026-07-20.
- **Madurez/stack:** agregador MCP; README autodeclara 15 conectores/~220 herramientas; proxy de procesos/herramientas.
- **Datos/usuario:** fuentes argentinas como JUBA, SCBA, CSJN, SAIJ y boletines; cifras de fuentes son claims del proyecto.
- **Transferir:** catálogo de fuentes, estado y procedencia por conector; revisión humana ante CAPTCHA/SSO.
- **Límite:** licencia MCAR exige autorización escrita para uso comercial. No copiar conectores ni datos. Lista de conectores no prueba cobertura efectiva.

### 7. F-Boivin/RAG_CSJN_AI_ENG
[Repositorio/README](https://github.com/F-Boivin/RAG_CSJN_AI_ENG) · AGPL-3.0 · 1 / 0 · 8 commits; push 2026-09-17.
- **Madurez/stack:** demo pequeña de agentes y verificador determinista que comprueba existencia del caso y pasaje en evidencia.
- **Datos/usuario:** CSJN y doctrina sobre recurso extraordinario federal; README reporta prueba pequeña de consultas/citas.
- **Transferir:** suprimir afirmaciones sin evidencia recuperada.
- **Límite:** alcance temático estrecho; métricas autodeclaradas, no corpus civil general.

### 8. Free Law Project — eyecite
[Repositorio](https://github.com/freelawproject/eyecite) · BSD-2-Clause · 295 / 91 · push 2026-10-20.
- **Madurez/stack:** biblioteca Python estable para extraer/anotar citas judiciales y legales, formas cortas, “supra/id.” y normas.
- **Datos/usuario:** reglas US; Free Law describe patrones derivados de grandes colecciones.
- **Transferir:** separar detección, normalización, enlace y anotación; conservar span original y pruebas por formato.
- **Límite:** gramática estadounidense no sirve sin reglas/corpus argentino; medir confianza y revisión.

### 9. Free Law Project — juriscraper
[Repositorio](https://github.com/freelawproject/juriscraper) · BSD-2-Clause · 651 / 178 · push 2026-10-25.
- **Madurez/stack:** adaptadores de adquisición y metadata para tribunales de EE. UU., con logs y tests.
- **Motor/datos/usuario:** no es buscador ni corpus autónomo; integra fuentes.
- **Transferir:** conectores aislados, clasificación de contenido real/MIME y pruebas de contrato por fuente.
- **Límite:** no autoriza recolección; respetar términos, límites, acceso, CAPTCHA y robots.

### 10. Free Law Project — API client
[Repositorio](https://github.com/freelawproject/courtlistener-api-client) · BSD-2-Clause · 31 / 11 · push 2026-10-23.
- **Madurez/stack:** cliente Python y MCP para búsqueda, lectura, análisis de citas y alertas.
- **Datos/usuario:** consulta CourtListener; no mantiene corpus propio.
- **Transferir:** paginación acotada, lotes, enlaces a resultados y procedencia.
- **Límite:** dependencia externa y OAuth/cuenta según uso; no reemplaza Search ni debe acceder a datos privados.

### 11. Free Law Project — RECAP Chrome
[Repositorio](https://github.com/freelawproject/recap-chrome) · GPL-3.0 · 83 / 37 · push 2026-08-04.
- **Madurez/stack:** extensión de navegador que contribuye documentos PACER a RECAP.
- **Datos/usuario:** flujo estadounidense de aportación comunitaria.
- **Transferir:** sólo la idea de contribución con permiso y procedencia.
- **Límite:** PACER no es transferible; no sortear autenticación ni condiciones.

### 12. Harvard LIL — CAPstone
[Repositorio](https://github.com/harvard-lil/capstone) · MIT · 198 / 46 · push 2024-09-10.
- **Madurez/stack:** Django/PostgreSQL para XML CAP, metadata normalizada, fuentes auxiliares y correcciones.
- **Datos/usuario:** entorno Case Law Access Project, EE. UU.
- **Transferir:** historial de correcciones, versión de fuente y errores OCR preservados.
- **Límite:** esquema y reporters de EE. UU.; actividad del repo menos reciente.

### 13. Harvard LIL — cap-examples
[Repositorio](https://github.com/harvard-lil/cap-examples) · MIT · 70 / 25 · push 2022-09-13.
- **Madurez/stack:** ejemplos históricos de uso de API/archivos CAP.
- **Datos/usuario:** investigación y desarrollo sobre casos estadounidenses.
- **Transferir:** guías reproducibles de exploración de corpus.
- **Límite:** repo inactivo y fuente específica; no integrarlo como servicio actual.

### 14. Laws.Africa — Indigo
[Repositorio](https://github.com/laws-africa/indigo) · GPL-3.0 según README · 77 / 39 · push 2026-10-16.
- **Madurez/stack:** Django para crear/gestionar/publicar legislación estructurada en Akoma Ntoso.
- **Datos/usuario:** publicaciones legislativas de países africanos y equipos editores.
- **Transferir:** referencias normativas versionadas, jurisdicción y fecha de vigencia.
- **Límite:** legislación no es jurisprudencia; estructura y régimen legal son distintos.

### 15. mcp-dir/jus-mcp
[Repositorio](https://github.com/mcp-dir/jus-mcp) · MIT · 13 / 5 · push 2026-08-30.
- **Madurez/stack:** agregador MCP brasileño; README afirma >150 herramientas/consultas.
- **Datos/usuario:** conectores jurídicos de Brasil; cobertura autodeclarada.
- **Transferir:** MCP puede ser una capa de integración optativa con fuente separada.
- **Límite:** validar cada conector/licencia y no extrapolar fuentes brasileñas a Argentina.

### 16. jccamel/mcp-legalize
[Repositorio](https://github.com/jccamel/mcp-legalize) · MIT · 3 / 0 · push 2026-10-19.
- **Madurez/stack:** proyecto joven, MCP de sólo lectura sobre Markdown legal local; documentación de amenazas.
- **Datos/usuario:** depende de repositorios de legislación de cada jurisdicción.
- **Transferir:** tratar texto recuperado como input no confiable y enlazar la fuente.
- **Límite:** cobertura y actualización no acreditadas.

### 17. Fan-Luo/Legal-RAG
[Repositorio](https://github.com/Fan-Luo/Legal-RAG) · Apache-2.0 según README · 13 / 1 · push 2026-02-16.
- **Madurez/stack:** demo educativa con chunks jerárquicos, filtros, BM25, FAISS, dense, ColBERT/RRF y evaluación.
- **Datos/usuario:** ejemplos pequeños de derecho chino/UCC.
- **Transferir:** evaluar Hit@K/MRR/nDCG, separar metadatos y pasajes.
- **Límite:** demo, corpus pequeño y supuestos de otras jurisdicciones.

## B. Gestión documental e investigación

### 18. paperless-ngx
[Repositorio](https://github.com/paperless-ngx/paperless-ngx) · GPL-3.0 · 47.085 / 3.278 · push 2026-10-25.
- **Madurez/stack:** DMS self-hosted con OCR, metadatos, etiquetas, búsqueda por campo/booleanos, vistas guardadas, operaciones masivas e historial.
- **Datos/usuario:** archivos personales y de organizaciones; tamaño no fijado.
- **Transferir:** filtros/vistas guardadas, estados de OCR y edición por lote.
- **Límite:** DMS general, no modelo de expediente; confirmar que toda sugerencia automática quede bajo control humano.

### 19. eikek/docspell
[Repositorio](https://github.com/eikek/docspell) · AGPL-3.0-or-later · 2.341 / 186 · push 2026-10-22.
- **Madurez/stack:** gestor Scala/Elm con OCR, texto, tags, notas, relaciones y API; changelog describe Solr/PostgreSQL.
- **Datos/usuario:** documentos de equipos/usuarios, sin corpus legal.
- **Transferir:** notas y relaciones de documentos.
- **Límite:** correo/intake general no es flujo jurisprudencial; revisar AGPL.

### 20. Mayan EDMS
[Repositorio](https://github.com/mayan-edms/Mayan-EDMS) · documentación declara Apache-2.0; metadato GitHub sin SPDX · 845 / 514 · push 2026-05-23.
- **Madurez/stack:** DMS con ACL por acción, versiones, retención, workflows, auditoría, favoritos y búsqueda de texto/campos; release 4.12.2 en septiembre 2026.
- **Datos/usuario:** gestión empresarial, no corpus jurídico público.
- **Transferir:** audit trail, permisos y comentarios.
- **Límite:** alcance y peso DMS pueden exceder la necesidad de Galilei.

### 21. Zotero
[Repositorio](https://github.com/zotero/zotero) · AGPL-3.0 según licencia publicada del producto; metadato del repo sin SPDX · 15.747 / 1.165 · push 2026-10-15.
- **Madurez/stack:** gestor bibliográfico con búsqueda avanzada, colecciones, tags, búsqueda dinámica, PDF y anotación vinculada a fuente.
- **Datos/usuario:** bibliotecas de usuarios, local-first con sincronización opcional.
- **Transferir:** colecciones sin copias duplicadas, notas y búsqueda guardada dinámica.
- **Límite:** metadata bibliográfica no alcanza para tribunal, expediente, materia y relaciones de autoridad.

### 22. DSpace
[Repositorio](https://github.com/DSpace/DSpace) · BSD-3-Clause · 1.105 / 1.504 · push 2026-10-23.
- **Madurez/stack:** repositorio institucional; colecciones/comunidades, metadata, facetas y ámbitos de búsqueda.
- **Datos/usuario:** universidades e instituciones.
- **Transferir:** mostrar scope y acceso en facetas/resultados.
- **Límite:** depósitos académicos no son jurisprudencia.

### 23. InvenioRDM
[Repositorio](https://github.com/inveniosoftware/invenio-app-rdm) · MIT · 184 / 203 · push 2026-10-22.
- **Madurez/stack:** repositorio científico con PostgreSQL/OpenSearch, versiones de registro, facetas, comunidades y filtros de acceso.
- **Datos/usuario:** datasets institucionales/científicos.
- **Transferir:** procedencia/versionado y facetas con acceso.
- **Límite:** DOI y flujos científicos no corresponden a precedentes.

### 24. Omeka S
[Repositorio](https://github.com/omeka/omeka-s) · GPL-3.0 · 527 / 176 · push 2026-10-23.
- **Madurez/stack:** colecciones culturales, vocabularios, metadata, sitios y visibilidad de objetos.
- **Datos/usuario:** museos/archivos.
- **Transferir:** colecciones/metadatos y atención a fugas de medios privados reflejada en releases.
- **Límite:** modelo cultural no representa la relación jurídica de precedentes.

## C. Motor, extracción y OCR

### 25. OpenSearch
[Repositorio](https://github.com/opensearch-project/OpenSearch) · Apache-2.0 · 13.905 / 2.988 · push 2026-10-24.
- **Madurez/stack:** motor existente de Galilei; REST, índices y agregaciones. Docs de RRF indican disponibilidad desde 2.19.
- **Datos/usuario:** motor de propósito general, sin corpus legal.
- **Transferir:** evaluar analyzer, ranking y RRF en un conjunto civil local.
- **Límite:** los benchmarks genéricos no justifican cambiar relevancia del producto; no tocar principal en esta investigación.

### 26. OpenSearch neural-search
[Repositorio](https://github.com/opensearch-project/neural-search) · Apache-2.0 · 122 / 142 · push 2026-10-21.
- **Madurez/stack:** plugin de embeddings/neural retrieval e híbrido.
- **Datos/usuario:** infraestructura general.
- **Transferir:** posibilidad de un modo semántico separado.
- **Límite:** compatibilidad exacta con 2.19.6 y complejidad operativa; evaluar por separado.

### 27. deepset-ai/Haystack
[Repositorio](https://github.com/deepset-ai/haystack) · Apache-2.0 · 26.841 / 3.338 · push 2026-10-24.
- **Madurez/stack:** framework de pipelines, BM25/dense/OpenSearch, filtros, joiners y evaluación.
- **Datos/usuario:** desarrolladores de sistemas de recuperación/RAG.
- **Transferir:** retrieval modular, prefiltrado y medición.
- **Límite:** framework no es producto ni corpus; podría agregar una capa innecesaria.

### 28. LlamaIndex
[Repositorio](https://github.com/run-llama/llama_index) · MIT · 52.660 / 8.425 · push 2026-10-23.
- **Madurez/stack:** conectores, nodos, retrievers, relaciones y evaluación para RAG.
- **Datos/usuario:** desarrolladores.
- **Transferir:** devolver siempre fuente y nodo con evidencia.
- **Límite:** no hace falta añadir framework para guardar citas o mejorar UI; revisar dependencia y mantenimiento.

### 29. Apache Tika
[Repositorio](https://github.com/apache/tika) · Apache-2.0 · 4.104 / 1.035 · push 2026-10-25.
- **Madurez/stack:** extracción general de texto y metadata de muchos formatos.
- **Datos/usuario:** infraestructura de ingesta.
- **Transferir:** separar detección MIME, extracción e indexación.
- **Límite:** no valida OCR, significado legal ni fuente original.

### 30. OCRmyPDF
[Repositorio](https://github.com/ocrmypdf/OCRmyPDF) · MPL-2.0 · 35.147 / 2.440 · push 2026-10-25.
- **Madurez/stack:** agrega capa OCR a PDF; usa Tesseract.
- **Datos/usuario:** documentos escaneados.
- **Transferir:** medir texto extraíble, idioma, páginas y calidad OCR.
- **Límite:** OCR no valida fecha, carátula o cita; controles humanos siguen necesarios.

### 31. Tesseract
[Repositorio](https://github.com/tesseract-ocr/tesseract) · Apache-2.0 · 77.163 / 10.854 · push 2026-10-24.
- **Madurez/stack:** motor OCR multilingüe.
- **Datos/usuario:** infraestructura de texto escaneado.
- **Transferir:** medir por idioma y tipo de documento.
- **Límite:** un texto OCR requiere confianza y ubicación de página.

### 32. Meilisearch
[Repositorio](https://github.com/meilisearch/meilisearch) · API consultada sin SPDX; verificar licencia antes de uso · 59.664 / 2.757 · push 2026-10-23.
- **Madurez/stack:** motor de UX interactiva, prefijos, tolerancia a typos y facetas.
- **Datos/usuario:** sitios y catálogos.
- **Transferir:** claridad del autocomplete y filtros.
- **Límite:** typo tolerance puede dañar expediente, nombres, citas, ñ o frase exacta.

### 33. Typesense
[Repositorio](https://github.com/typesense/typesense) · GPL-3.0 en metadatos · 27.042 / 1.022 · push 2026-10-25.
- **Madurez/stack:** instant search, facetas y typo tolerance.
- **Datos/usuario:** catálogo/web.
- **Transferir:** discoverability de facetas.
- **Límite:** no hay razón para migrar de OpenSearch; semántica general no coincide con contrato jurídico.

### 34. SearXNG
[Repositorio](https://github.com/searxng/searxng) · AGPL-3.0 · 38.833 / 3.535 · push 2026-10-24.
- **Madurez/stack:** metabuscador orientado a privacidad.
- **Datos/usuario:** motores web externos, no corpus legal propio.
- **Transferir:** minimización de telemetría.
- **Límite:** no autoriza fuentes ni resuelve búsqueda institucional; no enviar consultas sensibles a terceros.

### 35. OpenSearch Dashboards
[Repositorio](https://github.com/opensearch-project/OpenSearch-Dashboards) · Apache-2.0 · ~2,1k estrellas / ~1,3k forks · actividad reciente visible en GitHub en la semana de consulta.
- **Madurez/stack:** frontend de visualización/admin para OpenSearch; 39k+ commits visibles en el repo consultado.
- **Datos/usuario:** dashboard genérico de índices y analítica, no interfaz de jurisprudencia.
- **Transferir:** prototipos internos de métricas de cobertura y monitoreo si tienen permisos correctos.
- **Límite:** no es UX de búsqueda para abogados; evitar exponer un panel técnico a usuarios finales o datos privados.

## Síntesis

**Referencias maduras:** CourtListener, Paperless-ngx, Zotero, DSpace, InvenioRDM, OpenSearch. **Patrones argentinos valiosos pero acotados:** legal-rag y RAG_CSJN_AI_ENG. **Prototipos/claims sin auditoría:** llm-law-lib, Molao, mcp-legal-ar, jus-mcp, mcp-legalize. **Infraestructura, no producto:** Haystack, LlamaIndex, OCRmyPDF, Tika, Tesseract.
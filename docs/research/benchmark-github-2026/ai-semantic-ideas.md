# IA y búsqueda semántica

## Decisión

No reemplazar ni mezclar silenciosamente la búsqueda actual. Si se explora semántica, ofrecer un control explícito: **Búsqueda exacta/ léxica** (predeterminada) y **Explorar por significado** (opcional). Las respuestas y sugerencias deben indicar qué fallos y pasajes las respaldan.

## Opciones separadas

1. **Recuperación vectorial como modo de descubrimiento.** Usar embeddings para proponer candidatos, con filtros metadata/ACL antes de recuperar y presentación distinta. Mantener el motor lexical para consultas exactas, expediente, cita, nombre propio y frase entre comillas.
2. **Reranking local del conjunto recuperado.** Sólo tras probar retrieval y con medida de latencia; no permitir que el reranker oculte un resultado exacto.
3. **Asistente de explicación de fallos.** Generar una síntesis por secciones, cada afirmación con fragmento textual, documento, página y URL. Si la evidencia no está, responder que no puede concluir.
4. **Extracción asistida de citas y metadata.** Crear candidatos revisables, nunca auto-publicar tribunal, fecha, partes, expediente o relación doctrinal como hechos sin procedencia.
5. **Consultas sugeridas.** Ofrecer alternativas neutrales basadas en sinónimos confirmados; mostrar texto antes de ejecutar, preservar query original y permitir descartar.
6. **MCP sólo como integración optativa.** Exponer endpoints de lectura que respeten usuario, tenant, ACL y límites; no aceptar instrucciones procedentes del contenido de un fallo.

## Requisitos mínimos antes de un piloto

- Set de evaluación civil argentino, con consultas exactas y semánticas, negativos cercanos y abogados revisores.
- Separar recall de generación; medir Recall@K, nDCG@K, MRR, precisión factual de citas y latencia/costo.
- Comparación con motor actual para cada segmento: sala, año, texto completo, sumario, OCR, expediente, frase y consulta larga.
- No-regresión del contrato léxico, conteos, orden y filtros.
- ACL validada antes de cualquier retrieval, reranking, snippets, cache, exportación, streaming o logging.
- Datos permitidos para embeddings, modelo, región, retención y borrado. No enviar documentos privados o consultas institucionales a SaaS sin aprobación y base contractual.
- Registro de versión de corpus, modelo, prompt, chunker y embeddings; posibilidad de desactivar el modo.
- Respuesta con citas verificables a párrafo/página; comprobación determinista de existencia y soporte textual.
- Red-team de prompt injection en documentos: contenido recuperado se trata como dato no confiable, no como instrucción.
- UAT específico con profesionales, consentimiento, reporte de errores y revisión antes de activar a usuarios.

## Evaluación de referencias

- **legal-rag Río Negro:** buen patrón para fragmentos con validación textual; sus cifras/resultados son autodeclarados y la experiencia es prototipo.
- **RAG_CSJN_AI_ENG:** verificador de caso/pasaje inspirador para acotar el alcance; no cubre toda jurisprudencia.
- **OpenCaseLaw:** transparencia de corpus y citas pendientes, sin pretender que resolución = precisión.
- **Haystack/LlamaIndex:** componentes de pipeline y evaluación, no verificación de calidad jurídica.
- **OpenSearch neural-search:** infraestructura experimental que tendría que alinearse con la versión desplegada.

## Posponer

No resumir corpus en lote, no proporcionar consejo/estrategia procesal, no calificar “chances de éxito”, no inferir vigencia o autoridad por citas y no habilitar respuestas de IA con referencias fabricadas o fuente inaccesible. Primero se necesita evidencia rastreable y un set de calidad.
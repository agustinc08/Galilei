# Ideas de búsqueda

## Contrato que no se debe romper

Mantener prefijo léxico para texto plano, palabra exacta entre comillas, frase léxica exacta entre comillas, tolerancia a acentos, ñ distinta de n, insensibilidad a mayúsculas, extensión con %, filtros, operadores, campos, conteo y orden.

Antes de cualquier cambio, preparar un benchmark de regresión versionado con consultas sintéticas o anonimizadas: expediente, carátula, doctrina, frase, acentos, ñ, filtros combinados, sumario versus texto completo y acceso restringido. Cada consulta tendrá positivos/negativos revisados y motivo. No almacenar consulta sensible en analítica por defecto.

## Propuestas priorizadas

1. **Guardar consulta pública completa.** Reusar el servicio existente con un contrato versionado: texto, operadores, campo, filtros, orden y ámbito. Al abrir, restaurar URL y controles; no usar JSON manual como interfaz habitual.
2. **Mostrar cómo se interpreta.** Etiqueta prefijo/palabra/frase/campo y resumen AND/OR/exclusiones. Aclarar el significado de %.
3. **Explicar la coincidencia.** Mostrar campo, fragmento y filtros que sí se aplicaron. No presentar un score opaco como explicación causal.
4. **Añadir evaluación jurídica de relevancia.** Abogados califican relevancia por consulta; medir Recall@K, nDCG@K, MRR y latencia, segmentado por texto completo/sumario/OCR, Sala y época.
5. **Mejorar snippets con ubicación.** Mantener campo fuente, página y calidad OCR. No combinar fragmentos discontinuos como si fueran una cita literal.
6. **Ordenar facetas con usuarios.** Sala/tribunal, fecha, expediente, carátula/partes, materia, clase documental y disponibilidad de texto. En espacios, contar sólo después de aplicar ACL.
7. **Alertas opt-in.** Nuevos fallos que coinciden con búsquedas guardadas, con política de frecuencia, desactivación y autorización por ámbito.
8. **Ayuda contextual.** Mostrar ejemplos equivalentes a la semántica real del motor y atajos para limpiar filtros o volver a la URL original.

## Lo que otros motores no justifican

No aplicar globalmente stemming, sinónimos, typo tolerance, embedding, RRF o reranking LLM; no reinterpretar comillas, AND/OR, conteos o expediente. La búsqueda híbrida de OpenSearch/Haystack es una herramienta experimental, no evidencia de relevancia civil local. Meilisearch y Typesense priorizan UX general y tolerancia a errores, que puede degradar consultas jurídicas exactas.

## Criterio de salida de una prueba semántica

La opción semántica se evalúa aparte y rotulada. Requiere conjunto de relevancia civil argentino, métricas por consultas, recuperación de evidencia verificable, latencia/costo, y pruebas ACL negativas. Sin esto, permanece prototipo.
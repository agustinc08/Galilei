# Ideas no recomendadas o diferidas

1. **Reemplazar OpenSearch por Meilisearch/Typesense.** No hay evidencia de que otro motor mejore las consultas civiles actuales; incrementa migración y puede cambiar frase, prefijo, ñ y typo tolerance.
2. **Hacer semántica el default.** Rompe previsibilidad de una búsqueda jurídica exacta y oculta el motivo del match.
3. **Agregar typo tolerance global.** Puede “corregir” nombres, carátulas, artículos o expedientes a otra cosa.
4. **Stemming/sinónimos globales.** Cambia la semántica de frase exacta y requiere vocabulario civil controlado.
5. **Respuestas legales generativas sin citas verificadas.** Riesgo de cita o doctrina inventada; no hay evidencia de calidad suficiente para activarlo.
6. **Puntuación opaca de autoridad/vigencia.** La frecuencia de citas no determina vigencia, obligatoriedad ni corrección.
7. **Recolección de fuentes con bypass de CAPTCHA/login o URLs adivinadas.** Prohibido por diseño, riesgo legal y operativo.
8. **Copiar mcp-legal-ar o sus datos para Galilei comercial.** La licencia personalizada pide autorización escrita para uso comercial; no asumir permiso.
9. **Publicar automáticamente citas/grafo desde un parser o LLM.** Resolver citas ambiguas exige auditoría por formato y revisión; exponer candidato como hecho produce falsa autoridad.
10. **Telemetría de texto de consulta a terceros.** Puede contener estrategia legal, expedientes y datos personales; medir agregados con aprobación institucional.
11. **Buscar juntos espacios privados y corpus público sin separar ámbitos.** Elevado riesgo de filtración indirecta mediante conteos, facets, snippets, alertas, caches o URLs.
12. **Montar un framework RAG sólo por popularidad.** Haystack/LlamaIndex son componentes, no resultados probados para Galilei; primero verificar que la necesidad no se cubra con el stack existente.
13. **Resumir masivamente PDFs sin procedencia/página.** La síntesis pierde contexto y dificulta corregir errores de OCR.
14. **Exportar todos los PDFs sin revisar derechos y ACL.** La disponibilidad de descarga no supone permiso de redistribución.
15. **Convertir el benchmark en implementación.** Esta misión es research-only; cambios requieren priorización posterior y un gate de producto.
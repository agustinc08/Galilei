# Facetas y jurisprudencia reciente

La búsqueda pública expone facetas de **Sala** y **año de decisión**. OpenSearch las calcula en la misma petición, con el mismo query DSL y los filtros activos que producen la página de resultados. Las facetas no cambian el ranking, el orden, el total ni el contrato léxico; activar una faceta actualiza `sala` o `salas` (para alias agrupados) y `anio` en la URL, y reinicia la paginación. Los conteos son exactos para la consulta filtrada. Se muestran hasta 30 salas y todos los años que devuelve el histograma del índice.

En Suite 2, sólo los alias que consisten en una letra/dígito —por ejemplo `H` y `Sala H`— se agrupan bajo `Sala H`. El frontend transmite todos los valores originales como parámetros `salas` repetidos; el backend aplica un `terms` exacto sobre esos valores, preservando el conteo agregado y evitando unir salas con nombres completos distintos. Las búsquedas guardadas conservan el array multivalor.

La interfaz mantiene dos cronologías con significado explícito:

- **Fallos incorporados recientemente** conserva el endpoint ordenado por `publishedAt`.
- **Fallos más recientes por fecha de decisión** usa `Sentencia.fecha`, excluye fechas desconocidas y ordena por fecha descendente con ID como desempate.

Las facetas son únicamente de Jurisprudencia pública; no incluyen Corpus privado ni entregan información de documentos internos. Las facetas se guardan como estado normal de URL junto con el resto de filtros, por lo que volver, copiar el enlace y guardar/reabrir la búsqueda mantienen el estado.

Prueba del adaptador comprueba que OpenSearch recibe la agregación en la misma consulta y conserva counts/years. En esta candidata, el clúster principal se verificó en modo read-only y siguió en OpenSearch 2.19.6 GREEN con V4 en 69.313 documentos. La latencia de facetas y los conteos de términos no se midieron contra el servicio principal; la función está validada funcionalmente, no certificada en rendimiento.

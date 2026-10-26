# Editorial Gold v1 — muestreo y revisión humana

## Ejecución reproducible — 2026-10-26

La corrida con semilla `galilei-civil-editorial-gold-v1` y límite 400 leyó PostgreSQL 16 DEV mediante el guard exacto `127.0.0.1:55432/buscador_juridico_civil_dev`, rol `bjc_dev`. La población elegible fue de 6.014 fallos públicos/activos, todos PDF; se muestrearon 400 (399 con texto extraído, 1 OCR_REQUIRED sin texto y excluido de la revisión). Se asignaron 120 revisiones exhaustivas de estructura y 150 de citas. La selección determinista SHA-256 fue `9704164ed01c1a008943542e690232a8bf67c8e8af56f8da88ce316c37870b22`; el manifiesto generado tiene SHA-256 `109caabcdcd9bd2e64c67560269b5c84fb5560ae25160612cfc51bb208555317`.

El paquete ciego reproducible queda fuera de Git en `_recovery-work/galilei-editorial-gold-recall-suite4/human-review-package.zip`; incluye sólo los documentos asignados, formularios vacíos, manifiesto, catálogo público de destinos, guías, esquemas y hashes. No incluye el conjunto completo de texto, salidas del parser, predicciones ni resultados de máquina. El archivo `human-review-package.SHA256` permite verificar el ZIP. Los candidatos automáticos viven en el directorio hermano `machine-evaluation/` y no forman ground truth.

La evaluación observó en la muestra 59 fallos con outline y 170 secciones; el parser de citas emitió 16.178 candidatos (12.263 referencias a normas, 2.032 identificadores de expediente y las familias restantes en el informe JSON). No se calcula precisión ni recall: 0/120 etiquetas estructurales y 0/150 etiquetas de citas han sido recibidas. Proyección lineal, no estimación de calidad: 243.236 detecciones emitidas proyectadas sobre los 6.014 elegibles, de las cuales 25.409 son filas candidatas de relación entre fallos con identificador normalizado (1.690 en la muestra). La proyección final de CPU fue 1.962 ms medidos y 29.497 ms proyectados. Escenarios hipotéticos para revisar cada detección emitida: 675,7/2.027/4.053,9 horas a 10/30/60 segundos por ítem; para las filas de relación solamente: 70,6/211,7/423,5 horas. Son tasas hipotéticas, no velocidad observada, y no incluyen la lectura exhaustiva necesaria para encontrar citas que el parser omitió. El impacto de almacenamiento no se midió y requiere un dry-run PostgreSQL desechable separado.

Los tiempos del parser en la corrida final fueron estructura p50/p95/máximo 3,147/8,707/25,886 ms por documento y citas 0,913/2,411/8,695 ms; prueba adversarial de regex 2,7 MB: 4.067 ms, PASS. No se justifica modificar parsers ni ejecutar backfill sin el gold humano.

## Estado

El paquete reproducible se genera desde el corpus público con una transacción PostgreSQL `READ ONLY`. El texto completo queda en `_recovery-work/galilei-editorial-gold-recall-suite4/human-review/` y no se versiona. El repositorio guarda el contrato, las instrucciones, el importador y la evaluación. Hasta que lleguen las anotaciones humanas, toda métrica dependiente de ellas debe decir `PENDING_HUMAN_GOLD`.

No se usan modelos de lenguaje ni salidas del parser para establecer etiquetas esperadas. Los archivos de candidatos automáticos están separados de los archivos de anotación.

## Muestra

Versión: `civil-gold-v1`.

El valor por defecto es 400 fallos publicados y activos, con texto de páginas en la última extracción GENERAL. El muestreo usa semilla explícita y orden SHA-256 determinista; distribuye proporcionalmente entre estratos de año × Sala × MIME × calidad de extracción × documento largo (>30 páginas). El manifiesto conserva también longitud detallada (hasta 10, 11–30, 31+ páginas), junto con distribuciones marginales de años, Salas, estilo, calidad y longitud. Cada registro conserva su hash fuente y los pesos de inclusión. Se asignan 120 fallos para estructura exhaustiva y 150 para citas exhaustivas, ambas selecciones distribuidas de forma reproducible por año y Sala dentro de la muestra.

La muestra incluye el texto extraído por página, MIME, extractor, calidad, páginas y un catálogo de identificadores públicos/activos para que la persona revisora pueda comprobar destinos exactos. Sólo se asignan revisiones exhaustivas a documentos con texto extraído. Si un documento seleccionado no tiene caracteres extraídos, se registra en `excluded-from-human-review.jsonl`; jamás se lo interpreta como una sentencia sin encabezados ni citas. No incluye PDFs, texto de sentencias ni datos de la base en Git.

## Etiquetas

- Estructura: toda sección principal real, `NO_STRUCTURAL_HEADING` cuando corresponda, página, encabezado literal, tipo, ordinal y nota.
- Citas: cada referencia jurídica dentro del alcance, página, texto literal, familia, campos que se observan en la fuente, destino sólo si está identificado por evidencia exacta, expectativa de resolución y causa de falta de resolución. También se registran negativos seleccionados como `DO_NOT_DETECT`.
- Cada documento debe marcarse `HUMAN_REVIEW_COMPLETE` y `exhaustive: true`; el importador rechaza páginas, hashes, IDs y destinos que no coincidan con los paquetes.

Las guías están en [revisión de estructura](../structure-gold-review-guide.md) y [revisión de citas](../citation-gold-review-guide.md). Los esquemas JSON están en `server/test-fixtures/legal-gold/civil-gold-v1/schema/`.

## Evaluación

`pnpm --filter back run legal-gold:evaluate` ejecuta los parsers actuales sobre los textos muestreados, produce sus candidatos en un archivo separado, mide tiempos p50/p95/máximo y una entrada adversarial acotada, y calcula precisión, recall, F1, métricas por familia y resultados de resolución sólo cuando encuentra etiquetas humanas exhaustivas importadas. Sin esas etiquetas deja esas métricas explícitamente en `PENDING_HUMAN_GOLD`.

Las pruebas sintéticas validan el funcionamiento del evaluador; no cuentan como casos del corpus. No se modifica el parser mientras falte evidencia humana. Tampoco se ejecuta backfill o escritura en el corpus principal.

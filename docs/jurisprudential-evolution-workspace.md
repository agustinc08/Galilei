# Evolución jurisprudencial — Sprint 6

Estado: candidata local en `feature/jurisprudential-evolution-suite-6`, basada en `90fb74764ad28ffc8c30dec88a9008580ac157f2`. El despliegue de oficina y cualquier promoción quedan fuera de este sprint. La confirmación final depende del CI remoto para el SHA publicado.

## Alcance del producto

`/evolucion` permite reunir de 2 a 50 fallos públicos y activos desde Search, la ficha, colecciones, favoritos y el espacio de comparación. La bandeja mantiene slugs públicos durante la navegación; las rutas reproducibles no contienen IDs privados ni de espacios guardados. La ficha muestra una línea cronológica, filtros visuales por Sala, referencias y vínculos respaldados por datos.

La pantalla presenta fechas y relaciones almacenadas. No concluye que un tribunal cambió, confirmó, revirtió o abandonó un criterio, y no genera interpretaciones con IA, RAG, embeddings ni similitud semántica.

## Contrato de datos y relaciones

El endpoint público `POST /api/research/evolution/resolve` recibe entre 2 y 50 slugs públicos distintos. El servidor vuelve a consultar únicamente fallos `publicado` y `activo`; los elementos que dejaron de estar disponibles se cuentan en `omittedCount`, sin devolver sus metadatos.

La cronología usa exclusivamente `Sentencia.fecha`: ascendente, con slug como desempate estable. Las fechas inválidas o ausentes quedan en “Sin fecha disponible”; no reciben año ni posición jurídica inventados. El agrupamiento/filtro por Sala organiza la vista, no expresa una diferencia doctrinal.

“Mismo expediente” significa igualdad de la clave producida por `normalizeExpediente`, el normalizador compartido del backend. Conserva el prefijo completo y el año; acepta únicamente el formato con año final de cuatro dígitos separado por `/` o `-`, normaliza Unicode, mayúsculas y espacios, y no adivina coincidencias parciales.

“Cita verificada” corresponde a una fila almacenada con `status=VERIFIED`, `relationshipType=CITES` y destino identificado, cuyos fallos de origen y destino siguen publicados y activos. La dirección siempre es origen → destino. La vista conserva la cita fuente y, si existe, su página. Las candidatas detectadas, las rechazadas y las relaciones con destino no resuelto no se presentan como hechos. El endpoint limita la lectura de evidencia a 2.500 filas y comunica si llegó al tope.

El mapa muestra relaciones internas a la selección. Las cantidades de citas emitidas/recibidas son agregados del registro verificado y no afirman que esos otros fallos formen parte de la evolución actual.

## Espacios guardados, permisos y exportación

`ResearchTimeline` y `ResearchTimelineItem` se agregan con la migración aditiva `20261026150000_jurisprudential_evolution_workspace` (migración 37). Crear, listar, abrir, actualizar y borrar espacios es owner-only. Los IDs ajenos se ocultan con 404 genérico y cada lectura/exportación revalida que las referencias continúen públicas y activas. La descripción es texto privado acotado; no se interpreta como Markdown.

`POST /api/research/timelines/:id/export` exporta sólo el espacio propio. Reutiliza el generador de dossier de colecciones y su ZIP `galilei-research-bundle/1`; incluye `evolucion.json` con nombre, IDs públicos seleccionados, orden cronológico, tipos de relación y vínculos respaldados por evidencia. SHA-256 cubre cada archivo de datos y queda en `manifest.json`. No se agregan PDFs. La identidad/selección privadas no se publican en enlaces reproducibles.

La comparación desde la cronología se deriva al contrato Suite 5 `/comparar` (2–4 fallos); “Comparar con el siguiente” pasa dos fallos contiguos con fecha a ese mismo espacio. No se crea un modelo de comparación nuevo.

## Viewer y deep links de PDF

Los puntos de entrada públicos y de Corpus usan un único normalizador de página. El parámetro debe ser un entero positivo; valores ausentes, vacíos, no enteros, decimales o no positivos vuelven a página 1. Una página que supera el total se limita a la última página sólo después de conocer `numPages`. La URL se reemplaza por la página válida sin añadir una entrada al historial. El visor público y el de Corpus cubren valores malformados y fuera de rango; se conservan la búsqueda PDF local, los saltos de página y los enlaces copiados.

## Validación local registrada

- Migración fresca 0→37: PASS en PostgreSQL QA aislado `127.0.0.1:55434`.
- Incremental 36→37: PASS en un clúster de migración efímero, sólo loopback `127.0.0.1:55435`; se aplicaron 36 migraciones base y luego la 37.
- Backend: typecheck, lint, build y suite completa PASS (597 pruebas; 10 omitidas según el conjunto existente).
- Cliente: typecheck, lint, build y pruebas unitarias PASS (22); E2E de investigación PASS (22/22).
- E2E con API, PostgreSQL y OpenSearch reales: selección desde búsqueda, cronología, relaciones verificadas, exclusión de candidatas, comparación adyacente y seleccionada, guardar/abrir, exportar ZIP, hashes SHA-256, ausencia de PDFs, ocultamiento de exportación ajena, cuatro tamaños responsive; errores de página: 0.
- Resolver real por tamaño (2 calentamientos y 10 muestras; percentil nearest-rank; p95 con n=10 equivale al máximo): 10 fallos p50 16,10/p95 21,36/max 21,36 ms; 25 fallos 15,51/17,59/17,59 ms; 50 fallos 15,98/21,44/21,44 ms. Es una muestra pequeña, no un SLO.
- Search principal consultado sólo por GET HTTP: OpenSearch 2.19.6 GREEN, alias `galilei-search-active` → V4 con índice activo de 69.313 documentos. El verificador histórico de conteos y orden se intentó con su guard de sólo lectura, pero abortó antes de conectarse porque falta la configuración local permitida; los conteos certificados previos quedan como referencia histórica. No se modificó código ni datos Search.
- Vite conserva la advertencia existente de chunk PDF.js por encima de 500 kB. La máquina local expone pnpm 11.25.0, mientras el repositorio fija pnpm 12.15.0; el CI del SHA final debe certificar la herramienta fijada.

Los datos y servicios de estas pruebas son sintéticos y locales. La búsqueda principal, la base principal, DEV, MAIN, el corpus y Sytec10 no se modifican.

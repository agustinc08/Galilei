# Estado actual — Buscador Jurídico Civil

## GALILEI — SUPER MEGA ULTRA SPRINT 9 — búsqueda legal por página con OCR revisado (2026-10-27)

La candidata aislada `feature/page-aware-ocr-research-suite-9` parte exactamente de Suite 8, SHA `48736d1f82152d2e021b0fb9a660e3648a13b3ed`. Une cada resultado Corpus con la página física activa y su procedencia (`PDF_TEXT` u `OCR_HUMAN_APPROVED`), genera fragmentos sólo desde esa página y abre el PDF en el número físico indicado. Conserva la semántica Copernic/V4, el orden del buscador y la ACL existente. El texto OCR sin aprobar queda excluido; las citas provenientes de OCR siguen siendo candidatas y requieren verificación humana. El PDF, la publicación y los metadatos jurídicos no se modifican.

Decisión: schema 39 es suficiente; no se agrega migración 40, mapping Search ni rebuild completo. En QA aislada PostgreSQL 16.15 pasó 0→39, 37→39, 38→39 y 39→39. OpenSearch QA 2.19.6 aislado pasó 4/4 E2E de servicios reales: workflow Suite 8, deduplicación por SHA, hidratar páginas mezcladas en un PDF sintético de 50 páginas con exclusión de OCR draft, y aprobar durante caída de Search seguido de recuperación del mismo outbox. La verificación confirmó el checksum original.

Regresión local final: cliente y servidor typecheck/lint/build PASS; tests monorepo PASS (612 backend, 10 omitidos opt-in; cliente 22/22); research Playwright 23/23 incluyendo OCR por página, resaltado XSS-safe y cuatro anchos responsive. El build mantiene la advertencia no bloqueante de chunk PDF.js >500 kB. UAT institucional y `PENDING_HUMAN_GOLD` permanecen pendientes. Los reportes de cada dimensión y la distinción entre PASS y PENDING se guardan en `_recovery-work/galilei-page-aware-ocr-research-suite9/evidence/`. Push/CI exactos se consignarán al cerrar el branch; no promover a DEV/main ni desplegar a Sytec10.

Guía: `docs/page-aware-ocr-research.md`. Evaluación de arquitectura: `docs/page-aware-ocr-research-architecture.md`.

## GALILEI — SUPER MEGA ULTRA SPRINT 8 — espacio de revisión OCR humana (2026-10-26)

La candidata aislada `feature/ocr-human-review-suite-8` parte exactamente de Suite 7 en `f631eb9dc76c450fd0656ce5d6f341e4c711e116`. Agrega `/admin/jurisprudencia/ocr`, revisión de cada página, OCR local con procedencia, correcciones humanas versionadas, estados explícitos y aprobación documental. La aprobación crea una nueva `CorpusExtraction` y actualiza `CorpusDocument.searchText`; no modifica el PDF, metadatos jurídicos, citas ni publicación.

Certificación local aislada completada: PostgreSQL 16 `127.0.0.1:55434`, cadena 0→39, 37→39 y 38→39 PASS; 37→39 aplica consecutivamente las migraciones Suite 7 y Suite 8. Nest/HTTP + OCR local verificó roles/alcance, SHA del original, historial, página sin texto, rechazo/reapertura, conflictos optimistas y aprobación. Suite 7 integración: 10/10. Suite 5/6 research E2E: 22/22 (harness de investigación simulado). OCR UI: Edge Chromium en cuatro viewports, navegación por teclado, foco, etiquetas, anuncios de estado, contraste AA y sin desbordamiento. Backend: 599 aprobadas, 10 omitidas por gates de integración opcionales y 0 fallidas; cliente: 22/22; typecheck, lint y build pasan.

La integración real de Search probó que, con OpenSearch QA 2.19.6 aislado detenido, la aprobación persistió en PostgreSQL y el outbox quedó pendiente; tras recuperar el clúster QA GREEN, el worker existente procesó el mismo evento y el texto aprobado quedó visible en el alias QA. OCR de tres páginas: 1.869,2 ms; aprobación documental: 39,16 ms. La matriz y reportes están en `_recovery-work/galilei-ocr-human-review-suite8/evidence/`. Range 206/PDF Search figura PASS en la evidencia heredada de Suite 7, no se repitió en este sprint; la prueba de OCR verificó el visor PDF original en la ruta nueva. GitHub Actions run 9 pasó en `1a7aac274b8a6c0a25833b937f3fc97780978c43`: Client, Server y Production dependency audit en SUCCESS. UAT humano institucional y parser gold `PENDING_HUMAN_GOLD` siguen pendientes. No desplegar a Sytec10 ni promover a DEV/main desde este sprint.

## GALILEI — SUPER MEGA ULTRA SPRINT 6 — evolución jurisprudencial (2026-10-26)

La candidata local `feature/jurisprudential-evolution-suite-6` parte de Suite 5 en `90fb74764ad28ffc8c30dec88a9008580ac157f2`. Agrega `/evolucion` para seleccionar 2–50 fallos publicados/activos, ordenar por fecha decisoria, mostrar “Sin fecha disponible”, agrupar por Sala y exponer sólo citas `VERIFIED` dirigidas y coincidencias determinísticas de expediente completo/año. Reutiliza la comparación 2–4 de Suite 5 y añade comparación adyacente; no infiere cambios doctrinales ni usa IA.

Los espacios privados owner-only usan la migración aditiva 37 y revalidan disponibilidad en lectura/exportación. El dossier reutiliza el ZIP verificable de colecciones, con `evolucion.json`, manifest y SHA-256, sin incluir PDFs. La normalización del deep link del Viewer cubre Sentencia y Corpus y limita páginas sólo después de leer el total.

Validación local: PostgreSQL QA aislado fresco 0→37 e incremental 36→37 PASS; backend completo 597 PASS/10 omitidas, cliente 22/22, E2E investigación 22/22, typecheck/lint/build PASS. El E2E con servicios reales verificó selección, cronología, relaciones, ACL owner/foreign, comparación, exportación e hashes, cuatro viewports y 0 errores de página. Search principal respondió por GET con OpenSearch 2.19.6 GREEN, alias V4 y 69.313 documentos; el chequeo HTTP de conteos/orden no se pudo repetir porque el guard abortó antes de conectarse por falta de la configuración local permitida. El chunk PDF.js >500 kB y la disponibilidad local de pnpm 11.25.0 frente al pin del repo 12.15.0 quedan como hallazgos. El SHA publicado y su CI exacto se registran en el informe de cierre; no promover a DEV/main ni desplegar a Sytec10. Detalle de contrato y límites: `docs/jurisprudential-evolution-workspace.md`.

## GALILEI — SUPER SPRINT 5 — workspace de comparación (2026-10-26)

La candidata `feature/judgment-comparison-suite-5` parte del SHA exacto de Suite 4 `260b017e3fa3b2f26fea60c325790712db541bac`. Implementa una matriz `/comparar` para 2–4 fallos públicos, selección persistente entre rutas desde búsqueda/ficha/colecciones/favoritos, sumarios publicados, reseña editorial separada del resumen automático, expediente exacto, citas `VERIFIED`, notas personales de colecciones y visor PDF reutilizado con dos lados sólo bajo demanda. Comparaciones guardadas tienen propietario, nombre y referencias ordenadas; no admiten fallos privados ni enlaces compartidos con identificadores privados. Sin análisis jurídico generado ni cambios al gold Suite 4.

La migración aditiva 36 añade `ResearchComparison` y `ResearchComparisonItem`; la cadena fresca 1–36 y la incremental 35→36 pasaron en PostgreSQL aislado `127.0.0.1:55434`, con 0 pendientes y 0 fallidas. El E2E aislado real pasó API y navegador para 2 y 4 fallos, guardado/reapertura, ACL/IDOR, XSS, citas verificadas, expediente, PDFs, notas propias, retorno a búsqueda y cuatro tamaños responsive; errores de navegador/5xx: 0. Search principal se comprobó en modo lectura: 4.759 / 3.369 / 1.826 resultados, dos recorridos por consulta y 0 diferencias. El visor real pasó en seis documentos. La regresión de anonimización ahora omite nombres privados cuando faltan los valores públicos.

Validación local final: backend 586 PASS / 10 omitidos preexistentes; cliente 16/16; Suite 2 enfocada 41/41; gold tools Suite 4 4/4 con 0/120 etiquetas estructurales y 0/150 de citas (`PENDING_HUMAN_GOLD`); Prisma validate, typecheck, ESLint y builds PASS. Auditorías completa y de producción de backend y cliente: sin vulnerabilidades conocidas. No se agregaron dependencias. El build Vite mantiene una advertencia no bloqueante por el bundle PDF.js >500 kB. El SHA del commit, push feature-only y CI se registran en el cierre externo; no promover a DEV/main.

## GALILEI — SUPER SPRINT 4 — candidata de gold editorial y cobertura (2026-10-26)

La rama `feature/editorial-gold-recall-suite-4` parte del SHA `9a692cd76ac0503f0f58c86102aa8b867ef502d6` y es una candidata aislada: no se promueve a DEV/main. PostgreSQL DEV se consultó sólo por el guard de lectura `127.0.0.1:55432/buscador_juridico_civil_dev`, rol `bjc_dev`. La población pública/activa elegible fue 6.014; muestra determinista 400 (399 con texto, 1 OCR_REQUIRED excluido), con revisión exhaustiva asignada a 120 fallos para estructura y 150 para citas. Los paquetes externos incluyen textos asignados, etiquetas vacías, instrucciones, validadores, catálogo y hashes; excluyen cualquier predicción de máquina. No hay anotaciones aún, por lo que toda precisión/recall/F1/calidad y resolución validada está `PENDING_HUMAN_GOLD`.

El parser estructural observó 59 fallos con outline y 170 secciones; Parser V2 observó 16.178 referencias. La proyección read-only sobre el catálogo exacto público estima 243.236 referencias emitidas totales (25.409 filas candidatas de relaciones entre fallos) en la población; no es un resultado de calidad ni un plan de escritura. Parser CPU: 1.962 ms medidos en la muestra y 29.497 ms proyectados. La carga hipotética de revisión, sin lectura de fuente para encontrar omisiones, es 675,7/2.027/4.053,9 horas sobre todas las detecciones a 10/30/60 segundos; para candidatos de relación solamente es 70,6/211,7/423,5 horas. El almacenamiento de un backfill no se midió. No hubo cambios de parser, backfill ni escritura en PostgreSQL/Search/Corpus principal.

P3 Sprint 3 se cerró en QA aislada real: estructura y pinpoints, copia exacta con consulta/fragmento local, revisión y rechazo persistentes sin publicación, viewer privado y responsive pasaron en 390×844, 768×1024, 1366×768 y 1920×1080; errores inesperados de página/console/5xx: 0. El E2E autenticado detectó que el rol JURISPRUDENCIA no podía descargar PDF privado aunque podía abrir su ficha; se agregó autorización sólo al GET de descarga y regresión que conserva denegación a LECTOR y no amplía upload/delete. Procesos, PGDATA, OpenSearch QA, storage y credencial sintética ya se retiraron; PostgreSQL 55432 y OpenSearch 9200/9300 siguen activos.

Validación local: backend 580 PASS / 10 opt-in omitidos; cliente 16/16; regresión Suite 2 enfocada 62/62; Prisma validate, typecheck, ESLint, build y auditorías de producción backend/cliente PASS, HIGH=0/CRITICAL=0. Gold tools 4/4; etiqueta 0/120 estructura y 0/150 citas; todas las métricas de calidad siguen `PENDING_HUMAN_GOLD`. Search read-only público: 4.759 / 3.369 / 1.826, dos recorridos completos por query con 0 diferencias de orden; V4 GREEN, 69.313/69.313 IDs exactos, outbox 0/0. `search:opensearch:certify` histórico pasó 14/14 prefijos y 100/100 frases en scope Corpus. El cierre registra el CI del SHA publicado. Próximo paso: incorporar las etiquetas externas, ejecutar métricas ponderadas y recién entonces decidir si corresponde cambiar parser; no promover a DEV/main.

## GALILEI — SUPER SPRINT 3 — candidata de feature (2026-10-26)

La rama `feature/structured-judgment-citations-suite-3` parte del cierre de Suite 2 `a0503fd2b453642cb0dcc7ba8a33651531a8ab04`. `origin/dev=e06139e3075ef20a90d586973a7d301515ee5a67` y `origin/main=83947656420a9d6f6c3cfb12b353eb7f2c293a28` se verificaron sin cambios. Esta candidata no está promovida. Implementa estructura navegable determinista (`argentine-civil-structure-v1`), pinpoints vinculados al mismo PDF publicado, búsqueda local PDF.js y Parser V2 (`argentine-citation-parser-v2`) con procedencia por extracción/checksum/página/offset/contexto. La detección permanece `DETECTED_CANDIDATE`; sólo una revisión explícita puede crear una relación `VERIFIED`. Sin cambios funcionales de IA/RAG/embeddings ni del contrato de Search.

La navegación y el parser operan bajo límites de entrada y fallan cerrados ante texto/páginas fuera de rango. La estructura sólo se devuelve cuando la extracción `GENERAL` coincide con el archivo físico del visor; se marca completa únicamente con páginas secuenciales y recuento compatible; páginas de sección usan índices PDF 1-based, y las citas con página se rechazan si no existe ese mapa de página para el mismo PDF. El visor permite copiar la coincidencia PDF.js exacta junto a esa cita; consulta solo la página al backend y mantiene la consulta/fragmento local. La matriz UX sintética verificó esta acción en 9/9 viewports. No se afirma que la falta de esquema detectado signifique ausencia de secciones.

Evaluación read-only de corpus real: 200 sentencias / 3.350 páginas; 35 fallos presentaron esquema útil, con 78 secciones (55 numeradas, 22 Vistos, 1 Resolución); revisión contextual manual de las 78/78 secciones emitidas, sin falsos encabezados mayores. En citas: 6.074 detecciones distribuidas en nueve familias; resolución exacta única 68, autorreferencias suprimidas 154, no resueltas 5.852 y ambiguas 0. La inspección estratificada de 50/50 citas fue correcta, sin falsos positivos en esa muestra; el muestreo no está ponderado por prevalencia, la precisión/recall global y el recall estructural no se midieron. Evidencia resumida y límites en `_recovery-work/galilei-structured-citations-suite3/`.

Certificación candidata: PostgreSQL 16 QA `127.0.0.1:55434/buscador_juridico_civil_deepqa` y OpenSearch QA `127.0.0.1:19200` separados del principal; migración fresca e incremental 34→35 pasan. El E2E real cubrió estructura/navegación pública y privada, cita/link p. 2, búsqueda local, descarga, Range 206/416, página 2 aceptada y página 4 rechazada, destino privado 404, metadata privada y cola sin auth 401, confirmación editorial y unresolved; cuatro tamaños responsivos, 0 errores de página/console inesperados y 0 respuestas 5xx. La UI de PDF sin texto y la regresión Suite 2 corrieron en el harness de investigación, 17/17. Tras conservar la evidencia, los procesos y runtimes QA, storage sintético y credencial efímera se retiraron; PostgreSQL principal y OpenSearch principal siguen activos.

Typecheck, lint, build y validación Prisma pasan; servidor: suite completa previa 578 PASS / 10 opt-in omitidos y suite Corpus focalizada posterior 7/7; cliente 15/15 tests. Auditorías completa y de producción en backend y cliente: 0 advisories HIGH/CRITICAL. Build Vite conserva una advertencia no bloqueante de chunks PDF.js >500 KB. Search principal fue sólo lectura: responsabilidad civil 4.759, frase exacta “responsabilidad civil” 3.369, falta de servicio 1.826; SHA del orden completo idéntico entre dos lecturas para cada consulta; ningún cambio de código Search ni escritura en PostgreSQL/Search/Corpus principal.

Chequeo final `prisma migrate status` detrás de `with-dev-db-guard.cjs` confirmó sólo lectura contra `bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev`: 4 migraciones pendientes en esa base, sin deploy ni cambio de esquema. Las migraciones del candidato se validaron únicamente en PostgreSQL QA aislado.

Política de entrega: publicar cambios sólo en la rama feature y verificar CI para el SHA publicado. No promover a DEV/main ni ejecutar backfill masivo de corpus.

## GALILEI-RESEARCH-REPRO-SUITE-2 — candidata (2026-10-26)

`feature/research-reproducibility-suite-2` parte de `feature/post-uat-research-suite-1` en `d7b6e4ef478fbda5203d6f37b2cdec2a66c0bb9f`; `origin/dev` (`e06139e3075ef20a90d586973a7d301515ee5a67`) es ancestro de esa base y `origin/main` se conserva en `83947656420a9d6f6c3cfb12b353eb7f2c293a28`. La candidata agrega dossier ZIP privado verificable, novedades de búsquedas guardadas basadas en `publishedAt`, otras decisiones públicas del mismo expediente, CI y documentación de gobierno. No cambia el contrato COPERNIC, Search mappings/índices, RAG ni IA.

Validación Suite 2 local (2026-10-26): backend **458 PASS / 10 opt-in omitidos**, cliente Node **14/14**, Playwright de investigación **17/17** (UI/API mockeada), lint/typecheck/build PASS y auditoría completa y de producción sin advisories HIGH/CRITICAL. El ZIP de 100 fallos se generó y reabrió íntegro: 305 entradas, **132.279 bytes**, 92 ms en la ejecución medida; hashes SHA-256 y CRC verificados. PostgreSQL desechable recibió las 34 migraciones desde cero y la transición incremental **33→34**, con estado up to date y tres columnas de novedades; ambos clusters temporales se detuvieron y eliminaron. PostgreSQL principal `127.0.0.1:55432` fue consultado dentro de una transacción READ ONLY; identidad correcta y outbox 0/0. OpenSearch principal 2.19.6 GREEN, V3/V4=69.313, alias/writer V4, referencias 4.759 / 3.369 / 1.826, todo mediante operaciones de lectura. No hubo escrituras en principal PostgreSQL, Search ni Corpus.

Suite 2 queda como candidata de feature, sin promoción a DEV/main. El E2E del sprint usa Vite y mocks, no ejecuta los cuatro flujos contra API y servicios reales; la ACL está cubierta con pruebas unitarias/servicio, pero el paquete completo no tiene certificación E2E real. El build del cliente conserva la advertencia de chunk PDF.js >500 KB. El entorno local ejecuta pnpm 11.25.0 mientras `packageManager` y CI fijan pnpm 12.15.0; `pnpm install --frozen-lockfile` sí pasó localmente con 11.25.0. El primer resultado de CI en GitHub queda pendiente hasta publicar la rama.

P3 de presentación: la página sirve el icono explícito `/favicon.svg` (HTTP 200) y el test verifica su enlace. La auditoría encontró `next.svg` y `vercel.svg` sin referencias y retiró sólo esos dos assets; `client/src/app/` se conservó porque Vite todavía lo reutiliza. Las facetas que duplicaban alias de letra ahora agrupan `H`/`Sala H` como una etiqueta, pero filtran con los valores originales exactos; el estado multivalor se conserva en URLs y búsquedas guardadas.

## GALILEI-POST-UAT-PRODUCT-EVOLUTION-5-SPRINTS-1 — candidata funcional (2026-10-25)

La rama acumulativa `feature/post-uat-research-suite-1` parte del SHA `5869616156927a9f8f6ff220e33e9a711586dbe6`, conserva la continuidad de búsqueda y búsqueda local en PDF, y añade colecciones privadas/notas, facetas públicas por Sala/año con filtros en URL, cronología independiente por fecha de decisión y una base editorial para relaciones entre fallos. No está desplegada ni promovida. `origin/dev=e06139e3075ef20a90d586973a7d301515ee5a67` y `origin/main=83947656420a9d6f6c3cfb12b353eb7f2c293a28` permanecen sin cambios.

Validación candidata: typecheck, lint y build del workspace PASS; 421 tests de servidor y 14 de cliente PASS; Playwright de investigación aislado 11/11 PASS. Las migraciones nuevas pasan tanto actualización incremental como instalación fresca de las 33 migraciones sobre PostgreSQL desechable `127.0.0.1:55434`. PostgreSQL principal `127.0.0.1:55432` y OpenSearch 2.19.6/V4 GREEN con 69.313 documentos se inspeccionaron sólo mediante lecturas; outbox principal 0 pendiente/0 fallida. No se ejecutó backfill, no se aplicaron migraciones al principal y no se alteró el contrato de Search. UAT humana, revisión independiente externa, evaluación de citas sobre corpus etiquetado y medición de rendimiento de facetas quedan pendientes; ver `docs/features/research-continuity.md` y las fichas por función.

## GALILEI-RESEARCH-CONTINUITY-SPRINT-1 — candidata `PASS_WITH_FINDINGS` (2026-10-25)

La candidata se desarrolla en `feature/research-continuity-1`, basada en el UAT congelado `e06139e3075ef20a90d586973a7d301515ee5a67`. Añade enlace canónico, favorito en tarjeta con ACL/API existente, copia de cita pública con URL Galilei separada, explicación española desde el parser, ayuda actualizada y búsqueda pública guardada en JSON privado por propietario. No requiere migración. Cliente: typecheck/lint/test/build PASS y Playwright aislado 3/3; servidor: typecheck/lint/test/build PASS, 405 Jest pass/10 omitidos; Prisma validate PASS. No cambia el camino de Search, ranking, conteos, orden, mapping, índice ni corpus, y no escribe servicios principales. La API local `127.0.0.1:4000` no estaba disponible, por lo que las referencias golden (4.759, 3.369, 1.826; orden 7.694/7.694; producto 325/325) no se reejecutaron en este cierre y permanecen históricas. Sin promoción a DEV. Evidencia y límites: `docs/features/research-continuity.md`.

## Estado vigente — principal DEV y stack modernizado (2026-10-24)

**Equipo principal:** AgustinNotebook. **Raíz:** `C:\proyecto triple`. El árbol de trabajo está normalizado en `client/`, `server/` y `docs/`; `JurisprudenciaN/`, el antiguo `digesto/` y `docs-integracion/` fueron retirados después de preservar/reconciliar sus elementos únicos. La modernización se promovió por fast-forward normal desde el DEV certificado `749ad15fb429beb652863a51dcb6eb5dd906f841` hasta el candidato de código `82aac83c437700ea6dd8bd7310743b6659429789`, publicado también en `origin/refactor/galilei-stack-modernization1`. `origin/main=83947656420a9d6f6c3cfb12b353eb7f2c293a28` no cambió. El follow-up documental que actualiza este estado forma parte de DEV. No se usó force.

**Search y PostgreSQL principales.** OpenSearch 2.19.6 GREEN, 0 shards sin asignar. `galilei-search-active` apunta sólo a V4 `galilei-search-v004-20261020t094732495z-6015e394` con `is_write_index=true`; V3 y V4 mantienen 69.313 documentos. Se retiraron cinco V1 y un V2 por nombre físico exacto, sin tocar V3/V4; el store reportado liberado fue 10.189.407.675 bytes (9,49 GiB), con aumento de espacio libre de C: de 10.189.885.440 bytes en la medición inmediata. PostgreSQL 16.15 escucha en `127.0.0.1:55432`, DB `buscador_juridico_civil_dev`, rol `bjc_dev`; migraciones 31/31, outbox 223.815 procesados, pending=0/failed=0. La verificación fue `READ ONLY`; no hubo cambios de esquema ni escrituras en PostgreSQL/corpus. `_dev-corpus-storage/` se conserva.

**Stack modernizado en DEV.** El candidato `refactor/galilei-stack-modernization1` usa React/Vite, pnpm workspace y Node 24.22.1. La instalación congelada, typecheck/lint/test/build, reporter UX 63/63, Playwright público 22/22, responsive 18/18, Prisma validate y Golden aislado 325/325 constan en la evidencia previa. El cierre del visor corrigió el desajuste entre React-PDF 11.0.0 y PDF.js 6.4.299: React-PDF requiere PDF.js 6.3.289, que ahora usa el worker local de Vite. Workspace UAT autenticado pasó sus dos casos seriales; canvas PDF con contenido, descarga, Range 206, denegación y blob ausente fueron comprobados. Sprint 15.6.1 ACL enfocado pasó 1/1 en PostgreSQL aislado. La revisión independiente previa había encontrado P0=0/P1=0/P2=3/P3=1; la UAT cierra el flujo del visor, mientras otros hallazgos P2/P3 y su alcance quedan documentados en `docs/migracion-stack-2026.md`. UAT humana, preproducción y producción siguen separadas.

**Certificación funcional local — PASS_WITH_FINDINGS.** En QA aislada y eliminada: Auth/RBAC, ACL 12/12, Viewer/Range/Download/Missing Blob, lifecycle 10 transiciones/14 eventos con outbox drenado en cada paso, API negativa 25/25, concurrencia 1/5/10 (48 solicitudes, 0 timeouts/5xx), E2E autenticada 15/15 y 24/24 checks responsivos. Referencias de búsqueda: 4.759, frase exacta 3.369, “falta de servicio” 1.826; golden ASC/DESC 7.694/7.694, 0 diferencias y 0 timeouts. El cliente pasó typecheck, lint, pruebas de entorno 5/5, UX self 4/4, Playwright público 22/22 y build Next 16.4.2 (33 rutas). Hallazgo P3: el E2E registró cuatro mensajes de recurso 404 correspondientes a denegaciones ACL esperadas; cero errores de página, 5xx inesperados o filtraciones. El fix de autocompletado evita que una respuesta tardía reabra el menú tras perder foco. Evidencia: `_recovery-work/galilei-principal-final-functional-cert1/reports/`.

**Almacenamiento y límites.** El rescan de `C:\proyecto triple` previo al retiro de V1/V2 registró 49.188.767.650 bytes lógicos/asignados, 99.254 archivos y 11.615 directorios; no se repitió el tamaño total del proyecto después del retiro. La medición actual de C: registra 60,39% usado y 202.184.597.504 bytes libres. La retirada V1/V2 liberó 10.189.407.675 bytes de store y el espacio libre aumentó aproximadamente 9,49 GiB. Se preservan Search V3/V4, el corpus real, backups verificados y evidencia pequeña. Sytec10 no fue accedida; UAT humana y producción siguen pendientes.

## Cronología histórica — cortes anteriores (no representan el estado operativo actual)

Todo lo que sigue conserva decisiones, cifras y ramas de su fecha. Las etiquetas antiguas como “V3 activo”, “V4 shadow”, “pendiente” o “no promover” describen únicamente esos cortes históricos; el bloque de arriba es la única referencia vigente. La evidencia fuente se mantiene en los artefactos de cada misión.
## COPERNIC-RESTRICTED-ACL-FIX-2 — candidata (2026-10-19)

La rama `feature/copernic-restricted-acl-fix2` parte exactamente de `origin/feature/copernic-restricted-acl-fix1` (`e311f968e2920ef5f61a8957f7394d9252e589fd`). Corrige el bloqueo de paginación privada detectado en REVIEW-1: el recorrido PIT exige progreso estricto de `search_after`, detecta ciclos y lotes repetidos, exige el desempate final único `id asc`, falla cerrado ante respuestas incompletas/inconsistentes y cierra PIT en `finally`. La autorización viva continúa en PostgreSQL; no se alteran ACL, Auth, Viewer productivo, semántica Jurisprudencia, Prisma ni mappings.

La reproducción adversarial de REVIEW-1 queda cerrada: el mismo cursor/lote deja de falsear el total y falla con respuesta controlada 503. Search dirigido: 2 suites / 19 tests PASS; ACL DEV: 1 suite / 1 test PASS; suite backend segura: 47 suites / 322 tests PASS y 10 suites / 24 tests omitidos por gates opt-in; typecheck, build y lint dirigido PASS. El smoke público fue read-only. El muestreo real read-only en OpenSearch 2.19.6 observó 249 empates de `_score` en 250 documentos y avance estricto del tuple con `id` como valor final. No se pudo crear un índice sintético por permisos del clúster y no se hicieron escrituras.

Estado: candidata local para `COPERNIC-RESTRICTED-ACL-REVIEW-2`; sin promoción a DEV. La latencia de un recorrido privado de 69k sobre OpenSearch + PostgreSQL real sigue siendo una observación P2 pendiente; la medición de escala disponible es simulada. Los hallazgos de drift potencial entre predicados Search/Viewer quedan como riesgo P3. Rama y evidencia de calidad finales se registran al terminar commit/push; no se actualizarán `dev`, `main`, integración ni ramas UX.

## PREPROD-FIX-2 — candidata de hardening (2026-10-18)

La candidata `feature/preprod-uat-fix2` parte exactamente de `origin/feature/preprod-uat-fix` en `eb3397774b3d16ddafeac0ffba78ed54a8b7c8e7`. Cierra los P0 de query overrides DEV y solapamiento PREPROD/PROD, y el P1 de contratos DB de Prisma/libpq mediante identidad canónica y adaptadores explícitos. También endurece la reserva de la ruta de backup frente a los tres roots y limita rollback de alias a un único índice del mismo namespace/schema. No modifica semántica Search, ACL, Auth, Viewer, Processing, schema Prisma ni migraciones.

Verificación local: backend build/typecheck PASS; suite segura 45 suites PASS / 300 tests PASS, 9 suites PostgreSQL omitidas; tests dirigidos DB/config 45/45, guard/backup CJS 7/7, startup/OpenSearch 25/25 y frontend URL 5/5; frontend typecheck/build PASS; OpenSearch DEV sólo lectura 2.19.6 green, alias v3 activo, 69.313 documentos, 0 escrituras y 0 conexiones DB. El backup dry-plan prueba identidad/TLS/passfile y ahora exige ruta separada de DEV/PREPROD/PROD, pero no se ejecutaron `pg_dump` ni restore y no se verificaron ACL reales del passfile.

La rama se mantiene sólo como candidata para `PREPROD-FIX-2-REVIEW`; no se promovió a DEV. PREPROD/UAT no están provisionados; conexión DB preprod, TLS real, backup/restore, Docker e infraestructura institucional siguen sin probar. Evidencia local ignorada en `_recovery-work/preprod-fix2/`.

## PREPROD-FIX-1 — candidata técnica (2026-10-18)

La rama `feature/preprod-uat-fix` parte exactamente de `4d68c49d80642a19e93cc1af799fa78414421309` (`origin/feature/preprod-uat-prep`). Se implementaron cierres fail-closed para los dos P0 y tres P1 de PREPROD-REVIEW-1, más los P2 de loopback/IPv6, storage aislado, escrituras de startup documentadas, inventario de integraciones y topología. La candidata no cambia semántica de Search, ACL/autorización, Viewer, schema Prisma ni migraciones; no se promovió a DEV.

Verificación de esta candidata: backend/frontend typecheck y build PASS; suite segura 42 suites PASS, 272 tests PASS, 7 omitidos; nueve suites PostgreSQL de integración y un test SQLite opt-in quedan fuera de esa suite. Los nueve tests/configs del guard y namespace OpenSearch pasan (65/65), los tests de backup pasan (2/2), URL frontend (5/5), y ESLint de todos los archivos backend/frontend modificados pasa sin errores ni warnings. Los archivos CJS tocados pasan `node --check`. `git diff --check` pasa.

El smoke de DEV fue sólo lectura, con cuatro requests GET a OpenSearch: versión 2.19.6, health green, alias `galilei-search-active` → `galilei-search-v003-20261017t232432555z-a6af18cb`, 69.313 documentos; 0 conexiones DB y 0 escrituras. No se usó DEV como destino de herramientas de backup/migración.

La candidata está publicada únicamente en `origin/feature/preprod-uat-fix`; requiere revisión independiente PREPROD-FIX-REVIEW-1 antes de cualquier promoción. PREPROD sigue NOT_PROVISIONED; dump/restore real NOT_PROVEN; imagen Docker, storage de producción, certificado TLS y UAT institucional pendientes. Evidencia local ignorada: `_recovery-work/preprod-fix1/`.

## PREPROD-UAT-PREP-1 — estado registrado al cierre de ese corte (2026-10-18)

`origin/dev` y la rama de preparación parten de `af8f51d6f5e5be48e0167c5890328acd3c80c2c4`. UX quedó promovida y revisada; `main` permanece en `83947656420a9d6f6c3cfb12b353eb7f2c293a28`; `integration/galilei-beta` conserva el SHA certificado anterior `111bc5c86faff0bf946ef5e199b4463fe8217d5a`. La rama de esta misión es `feature/preprod-uat-prep`, publicada únicamente en origin y sin integración en otras ramas; el SHA publicado se registra en `git-final.json` de los artefactos ignorados.

**Preproducción no provisionada; UAT institucional no iniciada.** No hay host, DNS, TLS, storage ni base preprod autorizados en el equipo/repo. En la PC sólo se identificaron PostgreSQL DEV en `127.0.0.1:55432` y OpenSearch local en `127.0.0.1:9200`; no se usan como sustitutos. No se tocó producción ni se escribieron datos en DB/OpenSearch durante esta preparación.

Verificación local read-only: PostgreSQL client tools 16.15; el guard `prisma-migrate-status` confirmó 31 migraciones y schema DEV al día. La prueba aislada desde cero se reutiliza por hash desde la certificación INT-1R; no se creó una base temporal nueva. El alias DEV `galilei-search-active` está verde en OpenSearch 2.19.6, schema v3, 69.313 documentos; tamaño observado v3 14.158.744.471 bytes (13,19 GiB). Storage DEV `_dev-corpus-storage`: 17.098 archivos / 3.667.203.473 bytes; `back/uploads`: 11.747 archivos / 2.402.132.093 bytes. C: tenía 40,84 GiB libres, por debajo de la reserva de 50 GiB recomendada como mínimo operativo; no es sizing de preprod.

En `feature/preprod-uat-prep` se agregan guardas fail-closed para alias/prefijo físico OpenSearch exclusivos, bind loopback del API, API URL HTTPS exacta del frontend, commit limpio identificable, apagado de Swagger en runtime production, shutdown hooks, y credenciales/puerto seguros en el Compose local heredado. No cambian Search semantics, ACL, schema ni migraciones. Docker/Podman no están instalados; no se construyeron imágenes ni se ejecutó Compose. Instalación limpia, Prisma generate sin DB, builds Nest/Next y suite segura PASS; restore preprod, host y smoke de red real quedan sujetos a los gates detallados en docs 134, 136, 141 y 143.

## INT-1R — recertificación final (2026-10-18)

**resultado histórico: INT-1R PASS y promoción separada verificada.** `origin/dev == origin/integration/galilei-beta == 111bc5c86faff0bf946ef5e199b4463fe8217d5a`; ése es el SHA certificado. `main` permanece sin cambios. La reconciliación de UX corre aparte en `feature/ux-reconcile`, sin promoción a DEV. UAT institucional y preproducción siguen pendientes. INT-1S y la integración OpenSearch continúan cerrados; OpenSearch 2.19.6 es índice derivado schema v3 y PostgreSQL sigue como fuente de verdad. `galilei-search-active` apunta únicamente a `galilei-search-v003-20261017t232432555z-a6af18cb`.

La promoción tuvo una desviación procedimental por adelantarse a una autorización explícita de ese momento; se conserva tal como fue solicitada después: sin rollback, sin `--force-with-lease`, y con verificación read-only de igualdad entre DEV e integración. Esta nota no amplía el alcance de la promoción ni autoriza desplegar el branch UX.

**UX-RECONCILE-1 (2026-10-18): PASS en branch, no promovido.** `feature/ux-reconcile` se basa exactamente en el DEV certificado. Typecheck, build, lint dirigido y harness público (21 pruebas / 65 escenarios) pasaron; la E2E autenticada pasó con fixtures sintéticos y limpieza posterior. Hay 27 capturas autenticadas de tres rutas en nueve viewports y tres capturas adicionales del diálogo restringido. No hubo overflow horizontal, doble scroll inesperado, errores de consola, errores de página ni fallas de red inesperadas. No hubo cambios backend, Search, Prisma ni DB/migraciones. Ver `_recovery-work/ux-reconcile1/` local; la evidencia generada no se versiona. UAT institucional y preproducción continúan pendientes.

La recertificación encontró y corrigió una regresión de integración en la ruta pública: al usar OpenSearch se perdía parte del contrato de la respuesta legacy para Sentencias publicadas sin Sumario. La ruta ahora hidrata el contrato público y conserva sort/metadata; el resto de los cambios de código corrige y estabiliza los tests E2E integrados. Las referencias críticas actuales compararon por HTTP todo el conjunto publicado: `responsabilidad civil` 4.759/4.759 y `falta de servicio` 1.826/1.826, con igualdad exacta de IDs. Golden HTTP OpenSearch 325/325; fail-closed 503 seguro y cero invocaciones legacy; benchmarks críticos p95 173,86/240,03 ms sin timeouts.

Integridad actual: 69.313/69.313 IDs, 0 faltantes/extras/duplicados; Corpus 17.077, Sumarios 25.103, Sentencias 27.133, publicadas 6.014. El clúster está `green`; el outbox quedó en 0 pendientes / 0 fallidos; el índice v1 de 42.180 documentos se conserva como rollback. Prisma validate/generate/status pasan y las 31 migraciones están aplicadas. El replay desde cero se reutiliza por SHA: el artefacto de Sprint 1.5.1 registra las 31 migraciones aplicadas en un PostgreSQL 16 aislado y apagado; los hashes actuales coinciden. `bjc_dev` no tiene `CREATEDB`, pero no bloquea por existir esa prueba equivalente.

Calidad: backend 37 suites/224 tests pass, 8 suites/20 tests omitidos por gates PostgreSQL/SQLite opcionales o capacidades de OCR/Office; typecheck/build backend, typecheck/build frontend, lint dirigido y diff-check pasan. E2E frontend recertificado: 17 pass / 3 skips existentes; el visor Corpus real pasó aparte. La prueba PostgreSQL-only Sprint 15.5 se habilitó de forma diagnóstica y expiró en `C-PHRASE-LINE` por timeout del adapter legacy; no es la ruta activa OpenSearch, cuya Golden HTTP 325/325 y smoke de Corpus sí pasan. Sus fixtures se limpiaron y los 674 eventos transitorios se drenaron; integridad final quedó exacta y outbox en cero.

Capacidad: índice v3 13,26 GiB, rebuild equivalente ~72,9 min; el volumen local tiene 41,98 GiB libres, suficientes para certificar localmente pero debajo de la reserva de producción recomendada de ≥50 GiB. Evidencia detallada: `_recovery-work/int-1r-final/` y `_recovery-work/search-engine-integration1/` (ignorados por Git). Los registros posteriores mantienen su alcance/fecha; los cortes anteriores quedan supersedidos sólo respecto del estado registrado al cierre de ese corte.
## Sprint INT-1S.6 — resultados sin conteo exacto (2026-10-15)

**FAST_RESULTS_VIABLE: NO.** Se ejecutaron 1 warmup + 10 repeticiones de cada búsqueda sobre la ruta federada y el PostgreSQL DEV local, suprimiendo sólo el conteo total completo en una ruta diagnóstica temporal. “falta de servicio”: p50/p95/máx 4.125/4.255/4.255 ms; Corpus agotó el timeout SQL de 4 s en 10/10. “responsabilidad civil”: 4.145/4.210/4.210 ms y 10/10 timeouts Corpus. La interfaz no recibió una página Corpus utilizable en esas solicitudes parciales. Esto demuestra que sacar el total no basta: la generación/verificación/orden de la página todavía excede el presupuesto.

Se retiró el código temporal; no hay cambios de producto, migraciones, escrituras de DB, builds, promoción ni push de INT-1S.6. INT-1S e INT-1R siguen BLOCKED; DEV NOT PROMOTED; UX-2 NOT STARTED. No implementar conteo asíncrono ni iniciar INT-1S.7. Próxima decisión requerida: evaluar cambio de motor Search o redefinición del contrato de producto, en un alcance separado. Evidencia local ignorada: `_recovery-work/integration-int1s6/`.

## Sprint INT-1 — estado integrado de Galilei (2026-10-14)

**Dictamen: PARTIAL** en integration/galilei-beta. Los tips remotos de feature/jurisprudencia y feature/copernic están incorporados; workflow, Search/Viewer, documentos, OCR y ACL coexisten en código y esquema, con navegación superior para Jurisprudencia, Mi Sala / Juzgado y Mis documentos. Replay temporal desde cero: 28/28 migraciones; Prisma validate/generate/status PASS. La comparación raw registra proyecciones e índices SQL históricos fuera del datamodel Prisma e índices PostgreSQL con nombres truncados, sin borrado de objetos ni migration de reconciliación.

**Gates técnicos verificados:** suite backend 28 PASS / 10 omitidas; typecheck y build backend PASS; typecheck, build y lint dirigido frontend PASS; Search golden PASS; Search verify 17.078 docs / 18.799.500 tokens, stale=0, discrepancias=0/100 y rebuild=0; Viewer smoke 6/6; E2E de navegación, lector, operador, workspaces (incluye multi-dependencia) y ACL personal/restringida PASS. Cleanup DB sintético verificó 0 filas restantes; el audit de residuos devolvió candidates=[]. Cuatro blobs de prueba no referenciados permanecen en el directorio aislado _dev-corpus-storage-test/sprint1561-int1-e2e: la revisión automática rechazó su borrado. No se tocaron los roots del corpus real.

**Barrera para actualizar origin/dev:** el DEV local auditado tiene 21.109 sentencias, 0 publicadas y 21.083 activas no publicadas; la referencia J9 era 6.014 publicadas y 56 en revisión. Faltan _recovery-work/jurisprudencia-j7/final-summary.json y _recovery-work/jurisprudencia-j8/civil-certification-manifest.json; por eso no se puede repetir J8 ni demostrar que el snapshot esperado está presente. No se ejecutó ningún cambio editorial/publicación. Mantener origin/dev sin cambios hasta traer el snapshot/manifiestos autorizados y aprobar esos gates. Los registros de sprints anteriores debajo conservan su alcance y fecha originales.

Search PHRASE (10 repeticiones, "responsabilidad civil"): total p50 956,57 ms / p95 1.304,95 ms / máximo 1.304,95 ms; adaptador Jurisprudencia p50/p95/máx 183/188/188 ms y Corpus 956/1.304/1.304 ms. El p95 total supera 1.200 ms y queda como deuda antes de UAT.


## Auditoría de paridad de source — 2026-10-13

**Resultado: SOURCE EQUIVALENCE PASS en `dev`.** El clone limpio del commit `373e7c0add34580baade5fe873849c97f2fda061` instaló backend y frontend con `pnpm install --frozen-lockfile`; Prisma validate/generate, backend/frontend typecheck y builds pasaron. La suite backend sin runtime pasó 90 tests; 19 tests/suites optativos quedaron omitidos. No se copió runtime ni SQLite histórica.

La causa confirmada fue `.gitignore` raíz `**/logs/`, que ocultaba cinco fuentes `server/src/logs/` y la página `client/src/app/(admin)/admin/logs/page.tsx`. Se versionaron las seis, se limitaron las reglas de logs a rutas runtime y el test de paridad SQLite ahora se omite si no existe el fixture. Los JSON de ejecución en `server/logs/` siguen ignorados por su regla local. El fixture SQLite histórico es runtime de referencia optativo; no se subió.

La auditoría inspeccionó 589 archivos source-like bajo rutas compilables: 576 ya versionados y 13 candidatos ignorados/no versionados; se añadieron los seis archivos de código requeridos. Los otros siete candidatos son salidas JSON runtime, configuración IDE local y `next-env.d.ts` generado. Ninguno de los seis archivos añadidos tuvo coincidencias en el escaneo de secretos; el mayor agregado mide menos de 9 KiB. `pnpm exec eslint .` en frontend sigue reportando cuatro errores preexistentes de `react-hooks/set-state-in-effect` en páginas Corpus/Digesto/Revisión y una advertencia de variable no usada en `ProtectedContent.tsx`; no bloqueó typecheck/build ni pertenece a esta corrección.

## Sprint 14 — corte histórico 2026-10-13

**resultado histórico:** Sprint 14.8 ingirió el lote civil local; Sprint 14.9.2 dejó PHRASE en PARTIAL / PHRASE REGRESSION REMAINS (p95 comparable 2.427,38 ms; early exit no certifica total exacto). La auditoría posterior de fuentes Civil clasificó 5.738/10.600 enlaces y confirmó 4.862 sin intento, 17 challenges, 10 no disponibles y 1 error del visor; 452 grupos continúan en revisión. No se conoce un denominador oficial integral de cobertura. Ver corte de Sprint 15.1.1 + auditoría Civil al final de este documento.

Detalle: docs 146–158. Manifiestos no versionados: `_recovery-work/sprint14/`. No reauditar Search, preproducción ni raíces locales.

**Actualizado:** 2026-10-13, cierre técnico Sprint 14.9.2. **Dictamen de preproducción vigente:** Sprint 13.1 quedó BLOCKED / NOT EXECUTED y UAT PENDING. No se identificó destino preprod autorizado. El entorno y las cifras de la tabla siguiente describen el corte histórico de Sprint 8; los apartados Sprint 14.8–14.9.2 son la autoridad para el estado actual de Corpus/Search.

| Área | Estado / evidencia |
|---|---|
| Workspace | `C:\proyecto triple`; raíz no Git. No usar ruta vieja de OneDrive. |
| PostgreSQL | 16.15 loopback `127.0.0.1:55432`; DB `buscador_juridico_civil_dev`; rol `bjc_dev`; `pg_trgm 1.6`; escrituras con guard. Estado confirmado Sprint 14.8. |

## Sprint 14.9.2 — PHRASE windowed execution (2026-10-13)

- Benchmark comparable (15 familias, 10 repeticiones + 1 warmup): PHRASE p50/p95 2.225,24/2.394,03 ms → 2.272,01/2.427,38 ms. Delta +2,10% p50 y +1,39% p95; regresión permanece.
- El agregado ordenado consume 8.958 candidatos completos; sort de candidatos 401,526 ms, agregado inclusivo 402,253 ms, top-N final 11 filas/0,395 ms, 42.259 bloques leídos y sin temp spill. Tres tokens: 3.343 candidatos, cuatro expansiones, 8.726 ms de plan y 56.185 bloques leídos.
- La frase de 331 candidatos conserva 4 coincidencias con ventanas 100/200/331 y 2 expansiones. En consultas frecuentes, la salida temprana registra totalExact=false: el total exacto sigue siendo bloqueante.
- Experimentos de conteo exacto por materialización y GIN directo tardaron 29.515 ms y 32.008 ms. Se descartaron y se restauró el runtime base.
- Validación: Search verify PASS; paridad 40/40; viewer 6/6; parser/adapter 34/34; PostgreSQL 7/7; Corpus 3/3; suite 93 PASS / 15 omitidos; typecheck/build PASS; schema 44 tablas/21 migraciones. Concurrencia 1/5/10 usuarios p95 871,92/1.013,83/2.057,80 ms, cero errores.
- Evidencia no versionada: _recovery-work/sprint1492/. No modificar ni reabrir adquisición hasta PHRASE p95 <=1.200 ms y conteo exacto resuelto.

## Sprint 14.9 — PHRASE Search V2 (2026-10-13)

- Estado `PARTIAL / PHRASE REGRESSION REMAINS`: benchmark after sobre corpus completo (17.078 docs, 18.799.500 tokens), 10 repeticiones + 1 warmup. PHRASE p50/p95 1.645,16/1.752,99 ms vs baseline reproducido 2.586,78/4.082,32 ms; 10/10 requests sin errores after. El baseline reprodujo una expiración `57014` (9/10 adapters CORPUS exitosos). El p95 continúa sobre 1.200 ms.
- TERM común after 200,99/207,90 ms; PREFIX 718,43/835,72; SUFFIX 2.267,27/2.363,39; SHORT 1.697,09/1.946,98; FIELD 1.634,19/1.677,08. No se observó degradación material atribuible a la lógica PHRASE; SUFFIX varió +6,4% p95 en esta corrida.
- Causa confirmada: lecturas amplias de heap de `CorpusSearchToken` por candidatos trigram y repetición de la consulta al ampliar la ventana para certificar totales de baja cardinalidad. Una frase con cuatro resultados exactos tomó 4.431 ms y ejecutó tres consultas de página adaptativas (queryCount 4 con readiness). Cambio: anclaje de tokens de borde, intersección antes de aplicar elegibilidad una sola vez y un covering B-tree para prefijos. El índice se usa en EXPLAIN, pero persiste Bitmap Heap Scan.
- Índice `CorpusSearchToken_token_prefix_cover_idx`: 1.063.837.696 bytes; plan after de tres palabras llegó a 2.430 ms y 50.765 bloques leídos. El volumen físico y p95 >1.200 impiden cerrar el gate.
- Search verify PASS: 17.078 docs, 18.799.500 tokens, stale 0, discrepancias 0/100. Paridad 40/40, viewer 6/6, parser/adapter 34/34, Corpus PG 3/3, búsqueda PG 7/7, typecheck/build PASS y 21 migraciones al día.
- Concurrencia PHRASE: 1 request cold con 1 error de fuente CORPUS (~4,07 s); 5 users p95 1.295,70 ms/0 errores; 10 users p95 1.993,28 ms/0 errores. Riesgo cold-start/I/O sigue abierto. Evidencia: `_recovery-work/sprint149/`.
- Siguiente cuello medible: materializar candidatos para no reconstruir el SQL en cada ampliación adaptativa de ventanas de frases con pocos hits; conservar exactitud del total y recheck literal. En paralelo, medir si los postings permiten `Index Only Scan` para evitar lecturas heap. Medir cold/warm con más muestras. No iniciar preproducción ni reabrir adquisición por este resultado.
| Migraciones | 13 en DEV. Sprint 8 usa inventory/classification, extraction timing y `20261007220000_sprint8_corpus_title_trgm`; status limpio después del deploy. |
| Roots institucionales | 3 activos read-only: backend data, backend uploads y legacy extracted. Digesto server 278 PDFs se registró inactivo/excluido. |
| Inventario | 23.829 PDF-like físicos, 10.732 SHA únicos, 13.097 duplicados físicos, 4.866.746.671 bytes. Manifiesto y hash en informes 53/60. |
| Ingesta | Run `5a3ececa-3a55-4a08-bd20-bb43ce3e006d` SUCCESS; 10.727 nuevos, 5 existentes, 0 fallidos. Segunda pasada `90f64ee1-2dac-44b1-b3dc-59df4368a287`: 0 nuevos y 10.732 reutilizados, sin duplicar documentos/blobs/páginas. |
| Corpus | 10.732 documentos, 10.732 archivos, 10.732 eventos de ingesta, 23.829 ubicaciones, 95.392 páginas y 10.732 objetos content-addressed (2.115.402.746 bytes). |
| Extracción | 10.332 INDEXED (96,27 %); 399 OCR_REQUIRED (3,72 %); 1 INVALID_PDF; 0 FAILED/incomplete. p50/p95 extractor 49/360 ms en n=9.730. |
| Asociación | 0 EXACT/links; 27 HIGH_CONFIDENCE y 2 CANDIDATE pendientes; 10.703 UNRESOLVED. No se crearon Sentencias. |
| Clasificación | 21.547 RULE/SUGGESTED en 8.667 documentos; 2.064 sin sugerencias; 0 aprobadas. Evaluación determinista de evidencia 268/268 términos presentes en muestra n=100; precisión semántica no medida por falta de ground truth aprobado. |
| Search | Adapter Corpus usa AST compartido y Search federado existente. Smoke real `caratula:"30986" AND correspondiente`: 1 resultado/snippet/match/página, 36 ms después de índice; checksum real verificado. EXPLAIN del count 3.613,8 → 0,333 ms con GIN de título normalizado. |
| Viewer/UI | `/busqueda-avanzada`, `/corpus`, `/corpus/[id]` compiladas. Metadata/procedencia, abrir/descargar, salto `#page`, contexto de matches, anterior/siguiente. Sin resaltado dentro del PDF nativo ni acciones batch de review. |
| ACL | Todos INTERNAL, `NO_REVIEWED`, `REVIEW_REQUIRED`; ACL se aplica antes de metadata/archivo/matches. Pruebas de servicio pass; no hubo sesión HTTP real ni matriz institucional final. Nada publicado. |
| Digesto | No ingestado ni conectado al corpus real; 0 cross-domain links. El vínculo por `CorpusDocumentLink` se probó sintéticamente en M6; falta crosswalk real y Collections/Topics/Tags. |
| Fuentes públicas | CIJ/CSJN sigue NO GO para descarga automática; no se accedió a servidores institucionales. |
| Backup | Final DEV dump: `_recovery-work/sprint8/backups/...22-31-14-193Z.dump`, 220.752.700 bytes, SHA `1952184d7a8223071048e170f0b05cc84178a95e20f4d8579aef323a2842f329`. |
| Backend tests/build | `pnpm exec tsc --noEmit` PASS; suite general 58 PASS, 12 omitidos, 3 suites skipped; PostgreSQL 7/7, Corpus 3/3, paquete 2/2, tests dirigidos 13/13; Nest build PASS. |
| Frontend | `pnpm exec tsc --noEmit` PASS; Next production build PASS con las tres rutas anteriores. |

## Seguridad y datos fuente

Los originales se mantuvieron read-only; no hubo borrados, renombres, movimientos ni sobrescrituras. La reanudación usó el manifiesto existente; no repitió inventario completo. Ninguna operación salió de DEV loopback ni conectó producción/servidor institucional.

## Sprint 14.8 — cierre de ingesta y estado Search (2026-10-13)

- PostgreSQL DEV recuperado y verificado: PostgreSQL 16.15, `127.0.0.1:55432`, DB `buscador_juridico_civil_dev`, rol `bjc_dev`, `pg_trgm 1.6`; 20/20 migraciones aplicadas. La restricción local de Code Integrity quedó resuelta en Windows y el servicio volvió a Running.
- Backup anterior a escritura preservado en `_recovery-work/sprint123/backups/` y manifiesto inmutable `_recovery-work/sprint148/backup-before.json`. Backup final verificado: dump de 569.973.502 bytes, SHA-256 `2ebf2ab34364e46cee818b1eec26a73e6a7e791f6ecd424e3b381204506309cf`; SQL de 2.292.659.000 bytes, SHA-256 `b70c36f11017bf5fc2dd20120674480399840d0848b3862a78e50a9112537401`.
- De 5.710 filas fuente se incorporaron 4.596 documentos nuevos y se vincularon 160 documentos existentes: 5.176 registros de procedencia, 4.596 extracciones indexadas, 93.563 páginas y 191.181.254 caracteres; cero fallidos, inválidos u OCR_REQUIRED. Corpus Civil: 6.070 documentos (6.069 Cámara y 1 primera instancia). La segunda pasada confirmó idempotencia: cero nuevas altas, blobs o vínculos pendientes.
- 452 grupos jurídicos permanecen en revisión y no fueron fusionados automáticamente: 328 `CONFLICT`, 106 `CANDIDATE`, 15 `SAME_DOCUMENT_DIFFERENT_FILE`, 2 coincidencias exactas de documento y 1 archivo inválido. Cuatro PDFs con fechas de firma contradictorias quedaron retenidos para revisión de calidad.
- Search proyección: 17.078 documentos, 18.799.500 tokens, `stale=0`, 0 discrepancias/100, lista; índice de tokens 395.116.544 bytes; DB 3.996.515.351 bytes. Paridad de adaptadores 40/40; viewer 6/6. TERM p50/p95 203,50/278,78 ms; PHRASE 1.710,58/2.621,10 ms, regresión frente al corte anterior de 270/538 ms. EXPLAIN apunta a lecturas aleatorias de heap/filtrado de frases en corpus; antes de reabrir el backlog de adquisición se debe optimizar y volver a medir esa ruta.
- Verificación: suite backend 93 PASS y 15 omitidos (20 suites PASS, 5 omitidas); PostgreSQL 7/7, Corpus 3/3, paquete Corpus 2/2, typecheck, build Nest, estado de migraciones y verificación de proyección PASS. Las pruebas no alteraron los conteos.
- Corte de adquisición al cierre de Sprint 14.9.2 (histórico, supersedido por la auditoría Civil del 2026-10-13): 4.862 enlaces pendientes, 18 errores técnicos y 10 no disponibles (4.890 filas abiertas). No se ejecutó acceso institucional ni preproducción. Dictamen de ese corte: `PARTIAL / SEARCH REGRESSION`; sólo DEV local.

## Límites y siguiente gate

GO CON AJUSTES autoriza el uso y evolución local del flujo, no usuarios productivos. Antes de producción faltan decisión institucional de ACL/anonimización/retención, SLO/carga concurrente, revisión humana de asociación/clasificación, workflow de selección y Digesto, piloto OCR y hardening del visor (resaltado dentro del PDF, evaluación UI autenticada). También falta scan incremental con marca `sourceMissing`. Ver informe 60 y roadmap.

## Actualización de cierre Sprint 9 — 2026-10-08

Este bloque supersede los estados de Sprint 8 arriba donde haya diferencias.

| Área | Estado / evidencia |
|---|---|
| Resultado | NO GO integral de aceptación end-to-end y producción; GO acotado para DEV local. Informe 70. |
| Migraciones | 14 aplicadas; status limpio. 20261008100000_sprint9_digesto_taxonomy es aditiva. |
| Backup | Pre Sprint 9: _recovery-work/sprint9/backups/buscador_juridico_civil_dev-pre-sprint9-2026-10-08T03-19-16-620Z.dump, 220.766.179 bytes, SHA256 d4f0cce5e6a1b59b0c5a1360a7b55b6ecb6e8d7e3d88a9ce8d2a7df7bcd735ec. |
| Corpus actual | 10.732 documentos, 10.752 objetos (20 derivados OCR), 23.829 ubicaciones, 95.486 páginas. |
| Extracción actual | 10.352 INDEXED, 379 OCR_REQUIRED, 1 INVALID_PDF; valores históricos de runs del informe 60 no se reescriben. |
| OCR | Piloto español 20/20, 94 páginas, 174.292 caracteres, 29.424 palabras, 221.060 ms; originales verificados y visor conserva PDF original. Sin ground truth, exactitud no evaluada. |
| Scan incremental | incremental-2026-10-08T03-15-45-362Z: 23.829 unchanged, 0 altas/cambios/faltantes; no prueba sintética de los otros deltas. |
| Curaduría | Asociaciones: 27 HIGH_CONFIDENCE + 2 CANDIDATE pendientes; 10.703 unresolved. Clasificaciones: 21.547 SUGGESTED, ninguna aprobada. Links Digesto cruzados reales: 0. |
| App | Navegación unificada, /digesto, /revision, catálogo y visor extendido. Builds Next/Nest y TypeScript PASS; suite 61 pass/13 skip. Falta aceptación autenticada E2E. |
| Seguridad/operación | DB exclusivamente bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev; ninguna conexión productiva o institucional. Roots originales read-only. |
| Bloqueos | Usuario real de aceptación y matriz ACL; export/crosswalk Digesto autorizado y validación de permisos; ground truth OCR/clasificación; aceptación UX y realce PDF; política de anonimización/publicación/retención/SLO. |

Detalle funcional, gates y evidencia: informes 61–70. No inferir que selección editorial concede visibilidad o publica.

## Actualización de cierre Sprint 10 — 2026-10-08

Este estado supersede filas Sprint 8/9 anteriores cuando se contradigan. Ver `78-RESULTADO-SPRINT-10.md`.

| Área | Estado / evidencia |
|---|---|
| Resultado | READY FOR PILOT CON AJUSTES; DEV local acompañado, no producción ni aceptación institucional. |
| PostgreSQL | DEV `127.0.0.1:55432`, `buscador_juridico_civil_dev`, rol `bjc_dev`; 14 migraciones al día, sin migración Sprint 10. |
| Digesto local | 278 PDFs, 276 SHA únicos, 2 duplicados; 276 docs únicos Corpus `DIGESTO_LOCAL`; 264 indexados, 14 OCR_REQUIRED; metadata legacy no localizada. |
| ACL/E2E | Seis roles DEV; integración PostgreSQL 1/1, suite general 13/65 PASS y 5/14 omitidas; Playwright 3/3. Browser LECTOR/Admin; API seis roles. |
| Viewer/UI | PDF.js highlight y búsqueda interna con fallback; filtro colección Digesto y dashboard real con drill-down. |
| Performance | Browser smoke: colección 223 ms, primera página PDF 364 ms, dashboard 1.230 ms (una corrida); subquery Jurisprudencia interna 1,5–7,4 s en términos sin match, medir por adapter en Sprint 11. |
| Curaduría | Batch de clasificación auditado; selección Jurisprudencia con motivo/historial; membership Digesto por API. Batch membership/send-to-review y undo genérico pendientes. |
| OCR | Ground truth 20 páginas/11 PDFs; CER 19,43%, WER 28,97%; outliers severos; no ampliar. |
| Incremental | Corrida `incremental-2026-10-08T04-37-51-182Z`: 23.829 UNCHANGED; cero NEW/MODIFIED/MISSING; originales read-only. Deltas restantes cubiertos con fixtures. |
| Seguridad | Descarga y headers verificados; JWT localStorage, sin rate limit; mantener local DEV. |
| Builds | Prisma generate, Nest build, frontend typecheck/Next build PASS. |
| Pendientes humanos | Aceptación Secretaría/Digesto/Consulta/Admin, validación ACL, metadata Digesto y políticas antes de compartir. |
| Pendientes funcionales | Browser E2E de cuentas/roles no cubierto; el seed DEV y ACL API sí. Batch de membership/send-to-review, undo genérico y revisión N+1/carga siguen pendientes. |

Evidencia Sprint 10: informes 71–78 y artifacts privados en `_recovery-work/sprint10/`. No registrar credenciales en documentación.

## Actualización Sprint 11 — 2026-10-08

Ver cierre integral en `79`–`87`. El estado Sprint 10 de arriba queda supersedido por esta evidencia:

| Área | Estado / evidencia Sprint 11 |
|---|---|
| Dictamen | **NOT READY FOR PREPRODUCTION** por degradación de Search bajo concurrencia y recuperación DB sin validar. Sólo DEV local acompañado. |
| DB / migraciones | Host/puerto/DB/rol confirmados por guard; PostgreSQL 16.15; 14 migraciones al día; Prisma generate PASS. `bjc_dev` no tiene CREATEDB. |
| Sesión / hardening | `JWT_SECRET` requerido, vencimiento validado; usuario, rol y activo se releen por request. X-Request-ID, errores 5xx genéricos, logs sin query/body y rate limit local configurable. |
| UAT / ACL | Checklist imprimible lista; matriz ACL es propuesta sin aprobación; HUMAN ACCEPTANCE PENDING. Playwright LECTOR/Admin + navegación REVISOR/JURISPRUDENCIA/DIGESTO PASS 4/4; API/auth cubre seis cuentas DEV. |
| Search | Perfil end-to-end p50 6,8–13,8 s. En carga local de 5/10/20 usuarios, búsqueda p95 7,1/37,1/65,7 s; no apto para red compartida. Timeout SQL 4 s para detener consultas Corpus largas. |
| Dashboard | 5 endpoints UI paralelos; resumen agrega 18 query count/groupBy concurrentes. Sin N+1 por fila observado; con 10 usuarios el p95 llegó a 37,4 s. |
| Viewer | 11.008 PDFs inventariados, 93 con ≥50 páginas, 4 con ≥100, máximo 167 páginas/11,35 MiB. Rangos 206 pasan en 1, 50 y 109 páginas; PDF.js renderiza página elegida. Servidor aún bufferiza el archivo entero. |
| OCR | Dos outliers reevaluados con PSM 4/300 dpi: CER/WER 4,80/6,44% y 5,09/4,57%. No se actualizó el índice/extracción; revisión visual pendiente. |
| Curaduría | Preview y lote membership, batch send-to-review, reversión auditada de clasificación a SUGGESTED; E2E PostgreSQL 2/2 PASS. |
| Backup / restore | Dump DEV 222.191.432 bytes, SHA `6c8a1bac…25590db8`, cabecera PGDMP. Restore/list bloqueado por Windows App Control; no DB temporal por CREATEDB=false. No se intentó restore en DB principal. |
| Builds / tests | Backend full: 16 suites/70 PASS, 5 suites/15 tests opt-in omitidos; PostgreSQL E2E 2/2; Playwright 4/4; backend/frontend build y typecheck PASS. |
| Configuración frontend DEV | Corregido `NEXT_PUBLIC_API_URL` local a `http://localhost:4001/api`; build y Playwright repetidos PASS. |
| Demo | Preparación read-only PASS: seis cuentas, documento Digesto y clasificación sugerida encontrados; sin documento Jurisprudencia en cola de revisión; 0 registros fuente cambiados. |
| Digesto | No se encontró export autorizado de metadata; contrato del paquete en doc 80. No conectar remoto ni inferir crosswalk. |

La corrida completa de métricas y los límites se documentan en informes 79–87; artifacts locales sensibles/restringidos permanecen en `_recovery-work/sprint11/`.


## Cierre Sprint 12 — estado registrado al cierre de ese corte (2026-10-08)

| Área | Estado / evidencia |
|---|---|
| PostgreSQL | 16.15, `127.0.0.1:55432`, `buscador_juridico_civil_dev`, `bjc_dev`; schema verify PASS, 41 tablas, `pg_trgm` 1.6. |
| Migraciones | 14/14 actuales y status limpio. Migration-from-zero no probada: rol sin CREATEDB. |
| Search | NOT PASS: p50 5–20,3 s según familia; COMPLEX BOOLEAN p95 20,7 s; zero result 6,9 s. Filtro colección mejora p50 6,84→5,01 s. Benchmark 40/40 es histórico Sprint 5.3; repetición S12 expiró. |
| Concurrencia | FAIL. Search p95 7,0/36,5/74,0/82,3 s a 1/5/10/20 usuarios. Errores 0/9/3/5; throughput 0,25/0,44/0,49/0,49 req/s. |
| Backup/restore | Dump 222.192.378 bytes, SHA `416fee1bfc789ca79068d81cd8c5fcfc543fdf4cc10b7eefb799b0190aae1492`; restore temporal bloqueado por Device Guard y ausencia CREATEDB. No se tocó la DB principal. |
| OCR | No expandido. Dos páginas Sprint 11; ground truth/revisión humana insuficientes. |
| Viewer/hardening | Range 206 validado. Handler bufferiza archivos. JWT/roles/health/rate limit local implementados; proxy/TLS/rate limit distribuido pendientes. |
| Build/tests | Backend 18 suites/76 PASS, 15 opt-in omitidos; TypeScript/build PASS. Frontend TypeScript/build PASS; Playwright 4/4 PASS. |
| UAT/ACL/Digesto | UAT y ACL institucional PENDING; export/crosswalk Digesto PENDING; CIJ/CSJN NO GO. |
| Dictamen | TECHNICAL PREPRODUCTION — NOT READY. Informes 97 y 98; Sprint 12.1 limitado a bloqueos técnicos demostrados. |

Las secciones históricas anteriores conservan sus cifras de cada corte; esta tabla representa el estado registrado al cierre de ese corte.

## Cierre Sprint 12.1 — 2026-10-08

| Área | Estado / evidencia |
|---|---|
| DB DEV | PostgreSQL 16.15, `127.0.0.1:55432`, `bjc_dev`; 17 migraciones, `pg_trgm 1.6`, migrate status limpio; rol sin CREATEDB. |
| Search | NOT READY: común p50 6,26 s; PHRASE 7,68 s; complejo 14,77 s; Corpus `57014` en 5–10 de 10 mediciones según familia. Docs 99–101. |
| Concurrencia | FAIL: a 10 usuarios Search p95 45,57 s, 106 errores de fuente; a 20 p95 47,49 s, máximo 284,33 s, 224 errores; wait pico Prisma/Corpus 109/37. Doc 102. |
| Paridad | PASS 40/40, artifact `_recovery-work/sprint121/parity/benchmark.json`. |
| Backup / restore | Custom+plain final con SHA verificado; restore probado, ocho conteos y 20 hashes iguales, Search smoke PASS. DB temporal eliminada. Doc 103. |
| Migraciones vacías | PASS desde cero: 17/17 migraciones, 41 tablas, fixture/Search/cleanup PASS; DB temporal eliminada. Doc 104. |
| Backend | Prisma generate/typecheck/build PASS; 19 suites/79 tests; opt-ins adapter 7, Corpus 3, package 2, curation 1 PASS. |
| Frontend | Typecheck/build PASS, Playwright 4/4 PASS. |
| Dictamen | **TECHNICAL PREPRODUCTION — NOT READY**; docs 105–106. UAT/ACL/export Digesto PENDING; CIJ/CSJN NO GO. |

La causa de Search y los límites de las mediciones se explican en docs 99–104. La ola de concurrencia fue in-process y local; no representa proxy/TLS/red.


## Cierre Sprint 12.2 — estado registrado al cierre de ese corte (2026-10-08)

| Área | Estado / evidencia |
|---|---|
| PostgreSQL DEV | 16.15 en `127.0.0.1:55432`, DB `buscador_juridico_civil_dev`, rol `bjc_dev`; 20/20 migraciones limpias; schema verify 44 tablas, `pg_trgm 1.6`. |
| Corpus Search projection | PASS: 11.008 documentos, 9.475.712 tokens, 0 stale, muestra 100/100; índice GIN 210.452.480 bytes; rebuild idempotente 0 cambios. |
| Paridad | PASS 40/40; semántica 11/11 sin diferencias de IDs/orden; FIELD 1/1. |
| Search API | NOT READY: TERM común p50 5,91 s, PHRASE 7,40 s, ZERO 6,93 s; el adapter V2 Juri es ~0,2 s, pero el endpoint también espera el generador legacy. Corpus PHRASE/PREFIX/SUFFIX conserva expiraciones. |
| Concurrencia | FAIL: Search p95 6,33/24,58/35,65/35,94 s a 1/5/10/20 usuarios; HTTP errors 0/0/11/6; Prisma pool wait pico 0/2/35/80. |
| Tests/build | Backend 81 PASS en suite; opt-ins dirigidos PASS (Postgres 7, paridad 1, Corpus 3, package 2); TypeScript/build backend y frontend PASS; Playwright 4/4 PASS. |
| Migración limpia | Schema replay PASS con 20 migraciones/43 tablas y fixture; no equivale a DB vacía ni restore. Validación temporal de DB vacía permanece pendiente por CREATEDB/App Control. |
| Backup final | PASS; dual custom/SQL UTF-8 y SHA verificados en doc 116. |
| Dictamen | **TECHNICAL PREPRODUCTION — NOT READY**. HUMAN ACCEPTANCE, ACL y Digesto export PENDING; CIJ/CSJN NO GO. Sólo DEV local. |

Ver cierre formal en `115-PREPRODUCTION-GATE-SPRINT-12.2.md` y `116-RESULTADO-SPRINT-12.2.md`.

## Cierre vigente Sprint 12.3 — 2026-10-08

Este bloque supersede los dictámenes de Search Sprint 12–12.2 que indiquen que el endpoint estándar todavía ejecuta legacy o incurre en timeouts ya corregidos. Los registros históricos conservan sus valores de corte.

| Área | Estado / evidencia |
|---|---|
| Dictamen | **READY WITH NON-BLOCKING ADJUSTMENTS**, únicamente para continuar en preproducción controlada/UAT institucional. No producción/red compartida. Doc 124. |
| Hot path | 15/15 familias medidas con V2; `legacyMs=0`; Playwright buscó desde UI LECTOR. Filtros fuera de la capacidad V2 se mantienen hybrid. Doc 117. |
| Rendimiento | TERM común 118,6/234,3 ms p50/p95; PHRASE 1.400/1.459 ms; PREFIX 456/577; SUFFIX 965/1.169; SHORT 1.718/1.899. ZERO p50 15,8 ms. Doc 120. |
| Concurrencia | Search p95 a 1/5/10/20 usuarios: 259/1.331/2.619/4.284 ms; cero errores HTTP/fuente. 20 usuarios deja espera Prisma 123; topología local in-process, no representa red/TLS. Doc 121. |
| Pool Corpus | Aumentó de max 3 a 8 después de 47 errores de fuente iniciales a 20 usuarios; repetición y matriz completa 1/5/10/20 terminaron con 0 errores. |
| PostgreSQL | 20/20 migraciones limpias; schema 44 tablas; 16.15 y `pg_trgm 1.6`. No hubo migración nueva en 12.3. |
| Corpus projection | 11.008 documentos / 9.475.712 tokens; 0 stale; sample 100/100; GIN trigram 210.452.480 bytes. No rebuild necesario al cierre. |
| Jurisprudencia | No hay proyección física nueva; adapter V2 consulta tablas fuente y tuvo TERM común 118,6 ms p50. No se declara eliminado todo Seq Scan relacional. Doc 118. |
| Paridad | 40/40 PASS_COMPAT, sin diferencias reportadas. Doc 122. |
| Validación | Backend 86 PASS + 15 opt-ins omitidos; Postgres 7/7, Corpus 3/3, paquete 2/2; typecheck/build backend y frontend PASS; Playwright 5/5. |
| Backup | Custom 292.430.265 bytes SHA `77a7c488…ad8c19`; SQL UTF-8 1.207.928.742 bytes SHA `08635236…1fbf32`; doc 123. |
| Restore/DB vacía | PASS histórico Sprint 12.1, evidencia docs 103/104. Schema replay Sprint 12.2 es adicional, no contradicción. |
| HUMAN ACCEPTANCE / ACL / Digesto | PENDING. CIJ/CSJN automatizado: NO GO. |

Artefactos privados y sanitizados de Sprint 12.3: `_recovery-work/sprint123/`. Próximo paso: Sprint 13 de preproducción controlada + UAT, manteniendo DEV local hasta completar gates institucionales.

## Cierre Sprint 13 — 2026-10-08

Este es el corte histórico de preproducción/UAT; conserva Sprint 12.3 como último resultado técnico de Search en DEV.

| Área | Estado / evidencia |
|---|---|
| Topología | Sólo equipo local `AGUSTINNOTEBOOK`; no se identificó host BJC institucional autorizado ni proxy/TLS/cliente UAT. Inventario y gate en doc 126. |
| PostgreSQL | Único destino confirmado continúa siendo DEV `bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev`. No se utilizó como preprod. Sin DB o storage preprod identificados. |
| Deploy / migraciones | No ejecutados en preprod. No hubo build candidato ni importación. |
| Preflight de configuración | Validador de arranque y guard Prisma preprod implementados; suite sintética 6/6; `check` positivo/negativo sin conectar. Falta startup en target real; `LOG_LEVEL` no implementado. Docs 126/136. |
| Technical preprod | **BLOCKED / NOT EXECUTED** por ausencia de destino aislado autorizado; no es falla funcional. Evidencia DEV 12.3 no sustituye preprod. |
| UAT | **PENDING**; no hubo participantes humanos ni sesión. Guion listo en doc 127; hallazgos vacíos por falta de sesiones en doc 128. |
| ACL / anonimización / retención | **PENDING**; matrices preparadas en docs 129–131, sin decisión institucional ni cambios de permisos/políticas. |
| Digesto | Export/crosswalk autorizado **PENDING**. No se contactó sistema remoto ni se inventó metadata. Doc 80 sigue vigente. |
| Performance / operación | Sin medición ni health/backup de preprod. DEV 12.3 permanece como referencia en docs 120–124. TLS/CORS/proxy/limitación distribuida dependen de topología real. |
| CIJ/CSJN | Adquisición pública masiva automatizada continúa **NO GO**. |
| Production readiness | **NOT READY FOR PRODUCTION PLANNING**. Ver gaps reales en doc 138 y resultado en doc 139. |
| Validación local | Backend Jest 92 PASS/15 omitidas; Prisma generate, TS backend/frontend, Nest/Next builds, Playwright 5/5. No son prueba de preprod. Doc 139. |

Próximo gate: IT debe proveer un host privado y DB/storage nuevos autorizados; los owners de áreas deben definir UAT, ACL, anonimización, retención y corpus. Luego ejecutar runbook 136 y pruebas de docs 132–134 en ese entorno. No desplegar producción automáticamente.

## Cierre Sprint 13.1 — 2026-10-08

| Área | Estado / evidencia |
|---|---|
| Solicitud de infraestructura | Preparada para SYTEC en doc 140: host/OS/capacidad, PostgreSQL 16, Node, storage, DNS/proxy/TLS, firewall, vault y backup. Se usaron mediciones DEV 12.3 como referencia, no como sizing/SLO. |
| Bootstrap / deploy | Docs 143–144 y `scripts/deploy-preprod.ps1` preparados. El deploy exige aprobación, backup DB+storage con SHA, migraciones explícitas, servicio aprobado, readiness, proyección y smoke. No se ejecutó. |
| Guardas | Validator/config conserva fail-closed y ahora rechaza loopback aunque coincida con identidad declarada; guard agrega `db-report` y `projection-rebuild|verify|repair`. Sin conexión preprod real. |
| Datos / Search | Modalidad A/B/C pendiente del owner. No se copió/importó Corpus ni se modificó proyección. CIJ/CSJN bulk sigue NO GO; Digesto export/crosswalk PENDING. |
| UAT / políticas | Paquete de tareas doc 141; decisiones ACL/anonimización/retención doc 142; ambos PENDING hasta resolución institucional y sesión real. |
| Resultado | Ambiente preprod **BLOCKED / NOT AVAILABLE**; software **READY FOR PREPRODUCTION DEPLOY PREPARATION**, sujeto a repetir gates en target autorizado; HUMAN ACCEPTANCE **PENDING**. Informe 145. |


## Vigente — Sprint 14.2 (2026-10-08)

**Sprint 14.2 final:** el inventario histórico global quedó completo: 226.770/226.770 filas, 11.339/11.339 páginas, cero páginas fallidas. Se identificaron 1.277 fallos de Cámara Civil (2008–2013); 1.254 documentos nuevos ingresaron al Corpus y Search V2. El catálogo actual expone 110 Juzgados Civiles y 14 salas, pero las consultas siguen bloqueadas por `cap-widget`. El master operativo y el checkpoint están en `BJC-ADQUISICION-JURISPRUDENCIA.md` y `_recovery-work/sprint142/historical.sqlite`.


## Sprint 14.2 — corte histórico

El filtro `tid=18` enumeró 1.277 fallos de Cámara Civil (07/07/2008–28/08/2013). De los 1.277 flids, 1.263 PDFs se validaron, 13 ya estaban locales y uno devolvió 404 persistente. Se incorporaron 1.254 nuevos hashes al Corpus DEV; 1.253 quedaron INDEXED y uno OCR_REQUIRED. Search V2 quedó con 12.262 documentos, 10.035.849 tokens, cero stale y TERM p50/p95 113/227 ms, PHRASE 270/538 ms. El inventario global cerró en 226.770 filas y 11.339 páginas. Detalle operativo en `BJC-ADQUISICION-JURISPRUDENCIA.md`.

## Sprint 14.3 — adquisición Civil, 2026-10-09

| Medida | Resultado verificado |
|---|---|
| Feed reciente | GET público server-rendered; 20 resultados globales visibles, 1 Civil (Juzgado Civil 64, Secretaría 94), sentencia 2026-10-08. Sin submit de formulario ni CAPTCHA. |
| PDF nuevo | 1 HTTP 200, firma/MIME válidos, 214.836 bytes, SHA `39ed9ea0de1965a20e0db27577045cdb70893b04fb3c49baf802bf59049c70c7`; externalId `dfe01db5-ca63-4cf0-8193-6dbb5fbb6a0f`. |
| Ingesta / Search / visor | 1 paquete `TFN_ACTUAL_CIVIL` INTERNAL, 21 páginas / 53.476 caracteres, INDEXED; Search por texto y archivo/visor confirmados. |
| Cobertura en Corpus | Cámara 1.254 documentos distintos (2008: 1.210; 2009: 2; 2013: 42), 1.253 INDEXED + 1 OCR_REQUIRED. Primera instancia: 1, año 2026. Total Civil Corpus: 1.255. |
| Proyección | 12.263 documentos, 10.038.148 tokens, ready, stale 0, mismatch 0 en muestra 100. |
| Idempotencia | 1.ª ejecución: 1 PDF/documento nuevo. 2.ª: 0 PDF, 0 imports, 0 duplicados. |
| Exhaustividad | PARTIAL_BOUNDED_FEED; sólo 20 recientes visibles y sin paginación pública en GET. No garantiza detectar todo fallo entre corridas. |
| Backfill 2013→hoy | `HUMAN_CHALLENGE_REQUIRED`: búsqueda filtrada POST `acc=searchFallos` necesita `cap-widget`; no enviada. |
| CIJ | 2 notas de Sala Civil de 2018 sin identificador de causa y 1 lead indexado expte. 24.971/2024 en ruta PDF `/scp/d/`; 0 matches confirmables, 0 descargados. |

El PDF actual enlazado por el feed está en una ruta que el `robots.txt` de CSJN marca Disallow. Se deja registrado y no se automatiza el acceso futuro a esa ruta sin un canal/permiso que lo resuelva. No se repitió TERM/PHRASE benchmark: sólo se añadió un documento y no hay señal de regresión material. Preproducción sigue sin relación con este sprint y mantiene su estado independiente.


## Sprint 14.2 — corte operativo de adquisición Civil (2026-10-09)

- **Civil histórico filtrado:** 1.277 decisiones estructuradas de Cámara Civil, 2008–2013; 1.231 de 2008, 2 de 2009 y 44 de 2013. Juzgados Civiles de primera instancia no aparecen en el filtro histórico.
- **PDFs:** todos los 1.277 flids tienen estado: 1.263 verificados, 13 ya presentes localmente y 1 HTTP 404 persistente (`flid=101`). Los 1.263 forman 1.254 SHA únicos. Se incorporaron 1.254 documentos nuevos al Corpus, 1.253 INDEXED y 1 OCR_REQUIRED; 4.453 páginas y 7.457.999 caracteres extraídos.
- **Search V2:** 12.262 documentos y 10.035.849 tokens; proyección ready, cero stale y cero mismatches en muestra 100. TERM p50/p95 113/227 ms; PHRASE 270/538 ms. Search smoke y EXPLAIN 5 planes PASS.
- **Verificación:** parser 7/7; backend 20 suites y 93 tests PASS, 5 suites/15 tests omitidos; build PASS.
- **Backfill global:** 11.339/11.339 páginas completas, 226.770 filas descubiertas, cero páginas fallidas; la reanudación completó la página 9.032.
- **Fuente actual:** catálogo de 110 Juzgados y 14 Salas descubierto; consulta y sync siguen bloqueadas por `cap-widget`/token humano. CIJ no se rastreó de nuevo.
- **Dictamen:** inventario global histórico y cobertura de Cámara Civil completados; primera instancia actual sigue sin cuantificar por el widget humano. CIJ sin cifras nuevas. Detalle operativo en `BJC-ADQUISICION-JURISPRUDENCIA.md`.


































## Sprint 14.8 — checkpoint inicial, supersedido (2026-10-10)

- Manifest offline conciliado: 5.710 registros fuente, 5.050 PDFs físicos/SHA únicos, 5.049 PDFs parseables, 105.074 páginas y 1 archivo inválido.
- Deduplicación interna: 5.208 claves de documento jurídico; 4.756 NEW_DOCUMENT, 2 EXACT_DOCUMENT_MATCH, 15 SAME_DOCUMENT_DIFFERENT_FILE, 113 CANDIDATE, 321 CONFLICT y 1 INVALID_FILE. Candidatos, conflictos e identidades dudosas no se fusionan automáticamente.
- Ingesta pendiente. El servicio PostgreSQL DEV quedó detenido tras apagado limpio; Windows Code Integrity (eventos 3033/3077) bloquea `postgres.exe` porque la firma Authenticode figura `NotSigned` frente al nivel Enterprise requerido. No hay listener en `127.0.0.1:55432`, backup válido ni escrituras de Corpus/Search.
- En ese checkpoint, el próximo gate era recuperar PostgreSQL DEV antes de cualquier escritura. Se completó el 2026-10-13; ver el apartado vigente Sprint 14.8 arriba y `BJC-ADQUISICION-JURISPRUDENCIA.md`.

## estado registrado al cierre de ese corte — cierre Sprint 14.9.1 (2026-10-13)

Search continúa en DEV local y PARTIAL / PHRASE REGRESSION REMAINS. La proyección conserva 17.078 documentos y 18.799.500 tokens, stale 0 y 0 discrepancias en muestra de 100. Candidate set y ampliación PHRASE ahora se ejecutan en una sola consulta SQL además del readiness; el caso medido de cuatro resultados bajó de 4.431 a 2.094 ms y de 4 SQL a 2. La corrida comparable PHRASE de 10 requests dio p50 2.118 ms/p95 2.323 ms, peor que el baseline 1.632/1.763 ms y fuera del gate de 1.200 ms.

Paridad 40/40, viewer 6/6, pruebas parser/adapter 34/34, PostgreSQL 7/7, Corpus 3/3, suite general 93 PASS/15 omitidos, schema verify 44 tablas/21 migraciones PASS, typecheck y build PASS. VACUUM (ANALYZE) mejoró visibilidad a 99,985%, pero no logró Index Only Scan. Mantener Search local; el siguiente cuello medido es la lectura heap y el orden/agregado de todo el set candidato PHRASE. No continuar con los 452 grupos hasta cerrar este gate. Evidencia y límites en BJC-SEARCH.md y _recovery-work/sprint1491/.
## estado registrado al cierre de ese corte — Sprint 15 (2026-10-13)

**MVP de espacios privados IMPLEMENTADO en DEV.** Migración `20261013130000_sprint15_private_document_workspaces` aplicada en `bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev`, con backup pre-migración verificado ya existente en Sprint 14.9. E2E PostgreSQL sintético PASS: workspace A/B, mismo SHA/blob con documentos lógicos distintos, idempotencia por SHA dentro del mismo workspace, resultados aislados, general sin privados, acceso cruzado y acceso global por ID 404, lectura autorizada directa, carpetas/movimientos, membership y restricciones VIEWER. Suite backend 94 PASS/15 omitidos; typecheck y builds backend/frontend PASS; Search verify stale=0/mismatch=0, paridad 40/40 y viewer 6/6 PASS; schema 49 tablas/22 migraciones PASS. Benchmark canónico endpoint tras warmup + 10 requests: TERM común p50/p95 202/266 ms; PHRASE 1.934/2.226 ms; 0 fallos. Baseline comparable Sprint 14.9.2 PHRASE 2.272/2.427 ms; PHRASE mejora, pero supera el objetivo histórico de 1.200 ms y permanece PARTIAL. Espacio sintético de 1 documento: TERM p50/p95 3,9/5,4 ms; PHRASE 86,6/176,6 ms (3 muestras, no SLO).

El storage de prueba queda aislado bajo `_dev-corpus-storage-test/sprint15-workspaces` y se limpia con la suite. No se reindexó el corpus existente (17.078 documentos / 18.799.500 tokens) ni se editaron documentos de adquisición. Search PHRASE continúa PARTIAL según `BJC-SEARCH.md`. Este estado es sólo local DEV; preproducción, producción, UAT y acceso institucional siguen pendientes. Detalle y contratos: `BJC-ESPACIOS-DOCUMENTALES.md`.

## estado registrado al cierre de ese corte — Sprint 15.1 (2026-10-13)

**Sprint 15.1 PARTIAL; listo técnicamente para organizar un piloto en DEV, pendiente de UAT con personas reales.** Se implementaron en UI administración de workspaces y miembros, selección de alcance, búsqueda en espacio/carpeta/nombre, carpetas, carga 1–20 archivos con resultados por archivo, actividad y errores legibles. Playwright sintético pasó 2 escenarios en 1366×768/1920×1080; backend verificó ACL positiva/negativa, viewer y descarga cruzada 404, aislamiento de Search general y casos same-hash. Typecheck, builds, suite backend, Prisma y checks de Search previos PASS. No hubo acceso ni despliegue institucional.

Dataset sintético privado 100/500/1.000: última corrida TERM p50/p95 38,15/42,20; 446,55/457,30; 386,62/2.698,19 ms, total exacto. Corridas repetidas variaron hasta 2,30 s p50/2,39 s p95 a 1.000. PHRASE 141,39/143,90; 413,39/418,18; 297,42/312,57 ms, parcial (100 resultados) en 500/1.000. Count ACL aislado delta p50/p95 0,84/0,93; 59,34/66,64; 28,05/36,18 ms. `EXPLAIN ANALYZE` en 500 mostró índice Corpus por scope/status, luego nested loop ACL con 500 loops de 250 filas (124.750 descartadas), 81,81 ms/3.132 buffers hit. Microbenchmark variable, no SLO; seguir el predicado ACL y variación TERM antes de ampliar corpus. Overhead membresía+respuesta 2,49/4,76/7,01 ms TERM y 2,77/6,73/6,08 ms PHRASE. PHRASE heredó su deuda exact-total y no fue reimplementado.

Search general: 17.078 documentos, 18.799.500 tokens, stale=0, mismatch 0/100; paridad 40/40 y viewer 6/6. Aceptación por personal de juzgados/salas sigue PENDING y TERM sintético a 1.000 documentos mostró hasta 2,70 s p95, por lo que no declarar el Sprint CLOSED ni escalar el corpus del piloto sin seguimiento de rendimiento. Ver detalles y checklist ejecutado en `BJC-ESPACIOS-DOCUMENTALES.md`.

## estado registrado al cierre de ese corte — Sprint 15.1.1 (2026-10-13)

**PARTIAL; no ampliar los espacios privados todavía.** Causa ACL confirmada: estadísticas obsoletas estimaron 1 documento frente a 600 reales y forzaron 600 lookups repetidos, con 174.750 filas descartadas por unión. El Hash Join posterior quitó ese patrón. Se aplicó la migración local `20261013150000_sprint1511_private_search_stats_maintenance` con backup previo comprobado; sin índice nuevo ni reescritura de seguridad.

Dataset sintético 100/500/1.000/5.000, TERM exacto y realista: común p50/p95 32,7/69; 122,8/129,2; 365,9/417,0; 181,1/838,9 ms. En 1.000 y 5.000 se ejecutaron tres series; 5.000 common mostró max/p50 4,74×. El p95 de 5.000 y la serie más lenta superan el objetivo de ingeniería. Cero resultados tomó 500–590 ms por el conteo exacto. A 5.000 el costo residual está en Bitmap GIN de CorpusSearchToken (113.800 entradas), `Unique`/`Gather Merge`, y búsquedas PK repetidas al materializar los 5.000 candidatos; Hash Join ACL no descarta filas.

Seguridad, conteos, carpeta 2.500/5.000, paginación first/middle/last, concurrencia sintética 1/5/10, Search verify, paridad 40/40 y viewer 6/6: PASS. TERM general p50/p95 216/322 ms, +7,7%/+15,3% contra baseline Sprint 14.9.2 comparable; PHRASE quedó sin cambios y conserva su deuda. Suite Search específica 34/34 y prueba Workspace PostgreSQL dedicada PASS. No hubo acceso compartido, preproducción, producción ni UAT humano.

Próximo trabajo técnico: perfilar el statement completo de page/hydration y reducir el exceso de candidatos/deduplicación de `CorpusSearchToken`; volver a medir count exacto de cero resultados. Mantener el tamaño piloto, las ACL y el contrato de total exacto. Evidencia local ignorada: `_recovery-work/sprint1511/`. Detalle en `BJC-ESPACIOS-DOCUMENTALES.md` y `BJC-SEARCH.md`.

## Corte maestro — Galilei PC principal / Sprint 15.1.1 + auditoría de fuentes Civil (2026-10-13)

La máquina principal queda en `feature/jurisprudencia`, creada desde el `origin/dev` más reciente observado, `f7e37bc12436110191da15121bf047a0184e2e5a`. La máquina de oficina conserva su línea prevista `feature/copernic`; no se tocaron archivos de Copernic.

Snapshot PostgreSQL DEV confirmado por guard: PostgreSQL 16.15 en `127.0.0.1:55432`, base `buscador_juridico_civil_dev`, rol `bjc_dev`, 23/23 migraciones. El corte actual tiene 17.078 documentos Corpus, 6.070 Civil (6.069 Cámara por court field, 1 Juzgado Civil 64), 17.078 documentos Search y 18.799.500 tokens. De los registros Civil, 1.473 tienen `SECOND_INSTANCE`, 1 `FIRST_INSTANCE` y 4.596 carecen de `instance` explícita.

La auditoría de adquisición de 10.600 enlaces históricos está parcial: 5.738 clasificados, 5.710 filas PDF accesibles/5.050 blobs únicos (5.049 válidos y 1 inválido), 10 documentos no disponibles, 17 challenges visibles, 1 error del visor y 4.862 sin intento. Se cruzaron 4.758 claves seguras; 452 grupos permanecen para revisión. La base original contiene 15.478 filas temáticas; no se encontró denominador oficial completo de Cámara, primera instancia o CSJN Civil, por lo que no se publica un porcentaje global de cobertura.

El paquete runtime no versionado para PC oficina quedó en `_local-setup/office-runtime-transfer`, snapshot `galilei-pcmain-20261013T155544Z`, desde el SHA indicado. Incluye dump custom y los 17.098 blobs Corpus referenciados; workspace files/blobs actuales: 0. Manifiesto/checksums y todas las referencias verificadas; tamaño total 4.244.336.343 bytes. No contiene `_recovery-work`, secretos ni dependencias de build. La restauración en la otra PC aún no se ha ejecutado; el paquete está listo para transferir localmente.

Los nueve artefactos de discovery están bajo `_recovery-work/jurisprudencia-discovery/` y excluidos del commit. Resumen por año/Sala, endpoint, oportunidades y políticas se documenta en `BJC-FUENTES-DE-DATOS.md` y `BJC-ADQUISICION-JURISPRUDENCIA.md`. Estado final de esta misión: runtime mirror listo; source inventory y gap analysis parciales por falta de censos oficiales y rutas autorizadas.

## estado registrado al cierre de ese corte — Sprint J1 (2026-10-13)

Sprint J1 queda **PARTIAL**. PostgreSQL DEV fue verificado en `127.0.0.1:55432`, DB `buscador_juridico_civil_dev`, rol `bjc_dev`, PostgreSQL 16.15. Se generó y verificó backup preescritura de 570.040.784 bytes, SHA-256 `901b28b53c776d45a3912b2969cd2ba1c238f95060afc3de8d444c5667190cab`.

Se clasificaron y actualizaron 4.596 instancias `SECOND_INSTANCE` por corte exacto del nombre de Cámara y Sala explícita conservados en la procedencia del ingreso. Quedan 6.069 Civil `SECOND_INSTANCE`, 1 `FIRST_INSTANCE`, 0 sin instancia; Corpus total y Civil siguen en 17.078 y 6.070. `metadataOriginal`, texto y PDFs no se cambiaron. Search projection: 17.078 documentos, 18.799.500 tokens, stale 0, mismatch 0/100, lista. Idempotencia: 4.596 omitidas, 0 nuevas actualizaciones.

Los 452 grupos quedan: 328 conflictos clasificados por causa, 106 candidatos, 15 identidades con archivos distintos y 2 matches de identidad jurídica con SHA distinto en revisión; el único PDF inválido se rechazó como corrupto. No se crearon asociaciones ni se fusionaron documentos. Export humano: `_recovery-work/jurisprudencia-j1/human-review.csv` (451 filas); 1 caso rechazado queda documentado por separado. Coverage engine produce cortes por 35 años y 13 Salas sobre 14.154 claves conocidas; 4.756 matches enlazados por SHA exacto (33,6% **del set temático conocido**) y 2 identidades altas sin vínculo por SHA distinto; estos porcentajes no describen el total Civil. Artefactos y backup J1 están en `_recovery-work/jurisprudencia-j1/`, ignorados por Git.

## Sprint J2 — corte 2026-10-14

**Estado de primera instancia:** PostgreSQL DEV read-only confirmó 17.078 documentos; 6.070 Civil (6.069 `SECOND_INSTANCE`, 1 `FIRST_INSTANCE`, 0 desconocida). El único registro de primera instancia es `JUZGADO CIVIL 64 - SECRETARIA Nº 94`; años, expediente, fuente, URL de procedencia, SHA, MIME, bytes y páginas quedan capturados en `_recovery-work/jurisprudencia-j2/first-instance-current.json`. La auditoría independiente de `metadataOriginal` encontró 0 documentos Civil `SECOND_INSTANCE` con referencia inequívoca a Juzgado Nacional de Primera Instancia en lo Civil. Esto no es un censo total: denominador `UNKNOWN`.

El buscador oficial CSJN confirma consulta multi-instancia y anuncios de primera instancia desde 05/09/2025, pero no se encontró evidencia publicada de censo/export completo, ID estable, paginación total o permiso de automatización. Se preparó sin enviar una solicitud de export autorizada. No hubo descarga ni escritura en Corpus. El importador CSV/JSON de censo y el coverage engine aceptan un esquema canónico con año de expediente separado de fecha/año de decisión; fixtures y tests pasan.

Los 451 grupos no rechazados de J1 se clasificaron por bloqueo: 321 `MULTIPLE_CANDIDATES`, 106 `HUMAN_JUDGMENT`, 7 `METADATA_CONFLICT`, 15 `NEEDS_FILE_IDENTITY`, 2 `NEEDS_LEGAL_IDENTITY`; los 451 tienen archivos fuente locales presentes, por lo que `needs acquisition=0` para esta cola. De los dos casos con SHA distinto, ambos son compatibles con una versión distinta de la misma decisión por expediente, órgano/Sala/fecha, texto extraído, resolutorio/firmas y metadato de documento impreso; 15 grupos: 2 representaciones equivalentes, 12 versiones distintas concordantes y 1 inconcluso. Los archivos permanecen separados; linker v2 sólo dry-run, cero writes.

Search verify DEV PASS: 17.078 documentos, 18.799.500 tokens, stale 0, discrepancias 0/100. El proyecto no requiere migración Prisma para el dry-run. `CorpusDocumentFile` permite múltiples SHA por `CorpusDocument`, con provenance por `CorpusIngestionRecord`, pero el `linkExisting` actual sólo acepta un SHA ya existente y único; no expresa por sí mismo una identidad jurídica tipada. Evidencia, fuente oficial, solicitud borrador y comparaciones permanecen ignoradas en `_recovery-work/jurisprudencia-j2/`.

## Sprint J3 — cierre de readiness (2026-10-14)

**SPRINT J3 CLOSED — PIPELINE READY; AUTHORIZED EXPORT NOT RECEIVED.** Se agregó intake aislado para CSV/JSON/NDJSON, normalización canónica determinística, reportes de errores sin fail-fast por fila, detección de alcance/duplicados, conciliación y adquisición dry-run sin red ni DB. Request pack técnico está listo y no enviado. Pruebas: 12/12; fixture CSV sintético de 32 filas y corrida integrada sintética de 100 filas. Performance de intake+conciliación read-only con fixture 1:1 (filas Census/filas Corpus sintéticas): 100/100 filas 31,1 ms; 1.000/1.000 315,6 ms; 10.000/10.000 5,25 s (smoke de esta máquina, no SLO). Snapshot del único FIRST_INSTANCE contra el documento local: EXACT; cero escrituras.

PostgreSQL DEV verificado en sólo lectura bajo guard: `127.0.0.1:55432`, `buscador_juridico_civil_dev`, `bjc_dev`, server 16.15; conteos 17.078 documentos, 6.070 Civil, 6.069 SECOND_INSTANCE y 1 FIRST_INSTANCE. Search projection verify PASS: 17.078 documentos, 18.799.500 tokens, stale 0, 0 discrepancias de 100; verify no reconstruyó documentos. Prisma/migraciones/runtime Search/Corpus sin cambios. El denominador oficial sigue UNKNOWN y no se afirma cobertura civil total. Evidencia íntegra en `_recovery-work/jurisprudencia-j3/` (ignorada por Git).

## Sprint J4 — cierre read-only de review queue (2026-10-14)

**J4 CLOSED — 451/451 grupos clasificados y accionables; cero escrituras.** La auditoría DEV bajo guard confirmó el queue vigente: 328 conflictos, 106 candidatos, 15 grupos con SHA alternativos y 2 identidades legales de SHA distinto; el único PDF inválido se mantiene fuera de la cola de 451. Los 321 conflictos no metadata comparten estructura `ONE_SHA_MULTIPLE_LEGAL_KEYS`. En metadata conflicts (7), campos observados: DATE 6 ocurrencias, TITLE 4, CASE 3 y CHAMBER 3; los casos de desacuerdo quedan sin ganador y sin sobrescritura.

Reextracción local reprodujo 15 comparaciones: 2 `SAME_TEXT_RENDER`, 12 `SAME_DECISION_DIFFERENT_VERSION`, 1 `INCONCLUSIVE`. Los dos casos de SHA distinto fueron rehasheados/reextraídos desde los PDFs de source y Corpus, ambos concordaron como versión distinta de la misma decisión; no se asocian por limitación del modelo/linker. Los 106 candidatos quedan `INSUFFICIENT_DATA` porque el snapshot vigente no contiene IDs candidatos para compararlos; no se infirió identidad desde PDF/título. Clasificación de acciones: 428 `HUMAN_REQUIRED`, 7 `SOURCE_DATA_REQUIRED`, 16 `MODEL_LIMITATION`, 0 `AUTO_SAFE`, 0 `REJECT` (total 451).

Search projection se verificó read-only: 17.078 documentos, 18.799.500 tokens, stale 0, discrepancias 0/100, cero rebuild. Se agregaron únicamente tooling/tests CJS y scripts de paquete; Prisma, migraciones, Corpus/Search runtime y DB quedaron sin cambios. Paquete local e ignorado: `_recovery-work/jurisprudencia-j4/` (snapshot, comparación, ledger, HTML/CSV de revisión, fixture/import validation, schema options y performance). PHRASE Search sigue con su gate independiente pendiente; este trabajo de review no lo cambia.

## Sprint J5 — estado registrado al cierre de ese corte (2026-10-14)

El review package de 451 grupos ya contiene procedencia y evidencia por expediente. Ningún candidato de los 106 se pudo recuperar; 194 conflictos estructurales tienen varios expedientes exactos impresos en un mismo PDF y 127 siguen como colisiones de metadata. De 7 metadata conflicts, un expediente fuente quedó corroborado junto con otro expediente Corpus en el PDF; 6 conservan campos críticos pendientes. No se aplican links ni se cambia legal metadata.

Readiness: 2 listos para decisión humana, 106 sin candidato, 6 con datos críticos pendientes, 321 estructurales y 16 limitados por modelo. El paquete está en `_recovery-work/jurisprudencia-j5/`; tests CJS 19/19 y determinismo 10/10 pasan. DEV permanece en 17.078 documentos, 17.098 archivos, 17.685 ingestas y 18.799.500 tokens; Search verify: 0 stale, 0 mismatch/100 y 0 rebuild. El timestamp `verifiedAt` se devolvió al valor previo de J4 tras detectar que el comando de verify lo refresca. No hay cambios finales de contenido en Corpus/Search, Prisma ni migraciones. **Cierre técnico: PARTIAL**, porque ese refresco transitorio incumplió el gate estricto de cero escrituras aunque se restauró el valor previo.

## Sprint J6 — estado registrado al cierre de ese corte (2026-10-14)

J6 completó el análisis reproducible de los 321 grupos y la cola de revisión V3. Pruebas Node: 15/15 PASS; artefactos deterministas: 11/11 PASS. La DB DEV se mantuvo read-only, con cero intentos de mutación y sentinelas sin cambios. Search: 17.078 documentos, 18.799.500 tokens, 0 stale, 0 diferencias en muestra 100; `verifiedAt` estable.

Resultado `PARTIAL`: la identidad primaria tiene 187 propuestas confirmadas/probables listas para revisión estructural y 134 ambiguas/limitadas; las 127 colisiones de metadata incluyen 107 sin procedencia suficiente. No se aplicaron links ni correcciones, y no se decidió schema. Paquete local ignorado: `_recovery-work/jurisprudencia-j6/`.

## Sprint J6.1 — estado registrado al cierre de ese corte (2026-10-14)

Review tool local listo para revisión humana: 187 casos (P0 8, P1 174, P2 5), sample-20 determinista (P0 4/P1 12/P2 4), 14/14 tests J6.1 PASS (30/30 junto con J6). Snapshot J6.1 `2b04cdb75acaa36dec515b7b7d8e8928dc80186d10bb6b293d119317b6f1827d`; referencia J6 `541be6ede30c0f0e9cd68a9fbb7bad23d23b3f3f77d7f67ee354d686ecc3b3ac`. La app es HTML offline; no hace writes DB. Se verifica igualdad de sentinelas heredados de J6 y paridad Search (17.078/18.799.500, stale 0, mismatch 0/100, verifiedAt intacto).

**J6.1: READY FOR HUMAN UAT. Human UAT: NOT STARTED.** No inventar decisiones/acuerdo ni declarar cierre antes de revisar los 20 casos. Los 107 `UNKNOWN` de metadata continúan separados, sin correcciones ni asociaciones.

## Sprint J7 — calidad y procedencia del Corpus Civil (2026-10-14)

Auditoría read-only reproducible `j7-quality-v4`: 6.070/6.070 documentos Civil procesados, 0 errores. DEV confirmado en `127.0.0.1:55432/buscador_juridico_civil_dev`, PostgreSQL 16, rol `bjc_dev`. Bandas: EXCELLENT 4.814, GOOD 164, REVIEW 1.092, POOR/BROKEN 0. Procedencia completa 6.070/6.070; archivos válidos 6.070/6.070 (6.050 PDFs estructuralmente parseados y 20 textos); páginas con conteo consistente 6.023, sin faltantes ni números duplicados; 50 páginas vacías y 1 candidato OCR. Search Civil: 6.070 documentos, 9.323.788 tokens, stale/missing 0. Sin SHA duplicados; 12 pares de texto normalizado idéntico con SHA distinto (25 representaciones afectadas); 4 flags `MULTIPLE_LEGAL_KEYS`, 1.254 sin Sala. Propuestas: P1 8 acciones, P2 1.250; ninguna aplicada. Sentinelas antes/después idénticos: Corpus 17.078, archivos 17.098, páginas 198.129, ingestas 17.685, Search 17.078/18.799.500 tokens y `verifiedAt` intacto. Reporte y JSON completos, locales/ignorados, en `_recovery-work/jurisprudencia-j7/`. Cierre J7: `CLOSED` después de commit/push; J6.1 sigue `READY FOR HUMAN UAT`, sin decisiones humanas.

## Sprint J7.1 — dry-run de recuperación de calidad (2026-10-14)

**Cierre técnico `READ_ONLY_PASS`, determinismo verificado y cero escrituras.** Se revalidaron los 6.070 documentos contra J7 y el DEV local; no cambió el snapshot. Los 1.254 casos sin Sala coinciden exactamente con los 1.254 registros `CSJN_TFN_HISTORICAL`; evidencia local permitió 4 propuestas Sala `AUTO_SAFE_DRY_RUN`, 1 propuesta probable que requiere confirmación humana, 1 conflicto y 1.248 sin evidencia suficiente. Los 1.092 números/años inválidos se clasifican como 1.089 límites de normalización, 1 caso multi-causa/modelo, 1 campo desalineado y 1 valor malformado no resuelto; no se confirmó ningún dato incorrecto ni reparación de case/year.

## Sprint J7.1.1 — endurecimiento del normalizador Civil (2026-10-14)

Discovery de 1.089 limitaciones: ocho firmas estructurales; las cinco mayores cubren 1.083 y las siete mayores 1.088. La gramática nueva reconoce 1.079 `VALID_LEGACY` sin inventar año, deja 9 `PARTIAL` y 1 `MALFORMED`; los tres casos singulares de J7.1 siguen separados. De los 4.978 casos previamente válidos, 4.975 mantienen identidad y tres conservan ceros iniciales corroborados por la referencia fuente; cero cambios sin justificar. El snapshot guardado de J7.1 coincide, el proceso de parsing no accedió a DB y los sentinelas antes/después son idénticos. J6.1 conserva hash/estado, con 0 expedientes de la cola afectados conceptualmente. Search, Corpus, schema y datos no cambiaron. Artefactos con datos reales locales/ignorados: `_recovery-work/jurisprudencia-j711/`.

J7.1 reconstruyó 8 propuestas P1 (4 limitaciones del modelo de identidad y 4 sin evidencia suficiente) y 1.250 P2 sin regla batch segura. Preparó 5 operaciones hipotéticas de Sala (4 P2 auto-safe candidatas y 1 P2 con revisión humana); ninguna toca datos ni Search. La simulación auto-safe no cambia las bandas actuales; normalizar el parser hipotéticamente movería 1.089 filas de `REVIEW` a `GOOD`, pero dejaría las 1.256 claves jurídicas parciales intactas. Los 12 grupos de texto igual/SHA distinto incluyen 10 candidatos de representación de la misma decisión y 2 colisiones de metadata/texto genérico; no se fusionan. Se inspeccionaron los metadatos PDF de las 25 representaciones: dos productores aparecen entre grupos y cada grupo conserva su productor; las fechas de creación varían y no prueban cambio de versión. Las 341 procedencias múltiples son esperadas y se conservan. Los 4 casos multi-clave permanecen ambiguos tras cruces J5/J6; el pack J6.1 no tiene SHA en común con las cinco operaciones propuestas.

El único OCR candidato es también el único `TEXT_MISSING`: PDF válido de 4 páginas, cuatro page rows vacías, Search con 0 tokens, parser con 60 caracteres (16 alfanuméricos) y sin señal suficiente para declararlo image-only. Tesseract no está instalado; se recomienda reextracción nativa antes de decidir OCR. Search total sigue 17.078 documentos/18.799.500 tokens; Search Civil 6.070/9.323.788; stale/missing 0. Evidencia local/ignorada en `_recovery-work/jurisprudencia-j71/`. J6.1 continúa `READY FOR HUMAN UAT`, sin decisiones ni cambios a su input hash.


## Sprint J7.1.2 — evidencia de Sala histórica y completitud de clave (2026-10-14)

Análisis local completo, sin escrituras, de los 1.254/1.254 documentos CSJN_TFN_HISTORICAL sin Sala y de todo el texto de página ya almacenado (4.453 páginas históricas). Clasificación: 0 AUTO_SAFE_DRY_RUN, 365 PROBABLE_HUMAN_CONFIRMATION, 39 AMBIGUOUS, 849 NO_SELF_SALA_FOUND, 1 TEXT_INSUFFICIENT, 0 conflictos y 0 no-aplicables. La metadata raw descubrió 53 rutas de campo y cero valores estructurados explícitos de Sala; 15 menciones candidatas aparecieron en carátula/título, sin autoridad suficiente. Los 1.254 nombres de archivo carecen de marca Sala. Provenance: 1.254 source records conservan externalId prefijado y sourceReference con flid/expediente.

La regla de encabezado no alcanzó precisión perfecta en la validación conocida: 13 desacuerdos en 4.722 predicciones de encabezado y 11 en 4.576 de tribunal; por eso esas señales sólo quedan como propuestas humanas. El conjunto auto-safe limitado a evidencia estructurada produjo 4.479/4.479 aciertos en los 4.816 documentos con Sala conocida, pero en el universo histórico no hay ningún valor estructurado utilizable; no se generaron operaciones automáticas. Los cuatro auto-safe de J7.1 se degradaron: tres no se reprodujeron bajo el detector conservador y uno quedó probable. Artefactos con texto y snippets reales sólo en _recovery-work/jurisprudencia-j712/ (ignorado).

De las 1.256 claves legales parciales: 1.241 sólo Sala, 2 sólo expediente/año y 13 con múltiples componentes; normalización de Sala no resuelve por sí sola número/año. Hipótesis de aceptar las 365 propuestas humanas deja 896 claves parciales; no se aplicó ninguna. Las 1.254 filas siguen invisibles al filtro exacto por Sala; el adaptador compara CorpusDocument.chamber en vivo, por lo que no requiere rebuild/reindex al cambiar ese campo. Search continúa 17.078 documentos/18.799.500 tokens; Civil 6.070/9.323.788. Sentinelas before/after idénticos, J6.1 conserva hash y 187 filas listas para UAT, sin overlap ni decisiones humanas. Resultado J7.1.2: PARTIAL por falta de precisión segura para una reparación automática; cero escrituras y determinismo PASS.

## Sprint J7.1.3 — paquete de revisión humana de Sala histórica (2026-10-14)

Estado: **READY FOR HUMAN REVIEW; HUMAN REVIEW NOT STARTED**. Se reconstruyeron 365 casos probables y 39 ambiguos en una cola secundaria separada; 849 sin evidencia propia y 1 sin texto suficiente quedan fuera de la cola activa. La prioridad es operativa, no una afirmación de certeza: P0 4, P1 94, P2 267; la cola ambigua usa P3. La muestra UAT determinista de 25 cubre 12 Salas disponibles, años de decisión 2008/2009/2013, siete tipos de evidencia y P0–P2.

La app estática local presenta la sugerencia de máquina separada de la decisión humana, resalta contexto, advierte sobre citas de otras Salas y no expone paths PDF. Permite filtros, búsqueda, decisión explícita, undo, export/import de checkpoint con stale detection y export JSON/CSV. El filtro UAT muestra exactamente los 25 casos deterministas. Entrada reproducible: `node scripts/with-dev-db-guard.cjs sprint-j713-historical-sala-review-pack`; luego iniciar desde `server`: `node scripts/dev/jurisprudencia-historical-sala-review-server.cjs`. El server escucha sólo en `127.0.0.1:43173`. Evidencia y checkpoints permanecen ignorados en `_recovery-work/jurisprudencia-j713/`.

Generación read-only y sentinelas PostgreSQL/Search iguales; J6.1 sigue intacto. Playwright pasó el flujo completo con datos sintéticos y un smoke test del paquete real verificó los 365/39 casos y el filtro de 25; se registraron cero decisiones sobre casos reales. Próximo paso humano recomendado: sólo la muestra de 25; no asumir que deben revisarse los 365.

## Sprint J8 — certificación final del corpus Civil (2026-10-14)

`CERTIFIED_WITH_KNOWN_GAPS`: manifiesto determinista 6.070/6.070, sin duplicados ni faltantes; 0 `BROKEN`, `UNRESOLVED` o `UNKNOWN`. Archivos y provenance 6.070/6.070 válidos/completos; Search 6.070/6.070 presente, stale 0; Viewer 6.069 `READY` y 1 `TEXT_MISSING`. Se clasificaron las 50 páginas vacías: 46 legítimas y 4 candidatas OCR. Los 1.254 faltantes históricos de Sala están tipados entre revisión humana, ambiguos, sin evidencia propia y texto insuficiente; no se aplicó ninguna decisión ni corrección. PostgreSQL/Search, timestamps y storage no cambiaron. El 100% técnico significa estado conocido del corpus adquirido, no metadata completa ni universo total Civil. Detalle: `BJC-CERTIFICACION-CORPUS-CIVIL.md`; artefactos locales ignorados en `_recovery-work/jurisprudencia-j8/`.

## Sprint J9 — workflow operativo (2026-10-14)

Implementados búsqueda como entrada de Jurisprudencia, filtros progresivos, PDF-first para borrador, ingestión manual por Corpus, campo separado `juez`, acciones explícitas de publicar/retirar/archivar, controles de rol y aviso de posibles duplicados. Migración aditiva J9 aplicada en DEV con backup verificado; no hubo backfill ni escrituras al corpus certificado. Backend 97 PASS/16 omitidos, PostgreSQL J9 1/1 PASS, builds backend/frontend y typecheck PASS; J8 revalidado en `CERTIFIED_WITH_KNOWN_GAPS`.

**PARTIAL por ACL de publicación:** el snapshot DEV tiene 21.109 Sentencias y 0 publicadas; los 6.070 documentos Civil certificados están `INTERNAL` y sin asociación `JURISPRUDENCIA/SENTENCIA`. No se habilitó su lectura pública masiva sin decisión ACL. Browser E2E/UAT pendiente. Contrato y evidencia: `BJC-OPERACION-JURISPRUDENCIA.md` y `_recovery-work/jurisprudencia-j9/` (ignorado).

## Sprint J9.0.1 — publicación segura y cierre en DEV (2026-10-14)

Este resultado supersede el estado J9 `PARTIAL` anterior. La auditoría pre-write reconcilió 6.070/6.070 documentos J8, archivos, fuentes y provenance; workspace/private associations=0. El backfill creó o enlazó workflow público sólo para el subconjunto demostrablemente seguro: 6.014 publicados; 56 quedaron en revisión por colisiones de identidad legal y limitaciones de modelo/archivo. No hubo cambios al contenido, archivos, provenance, páginas, Search projection o visibilidad global Corpus; las filas incompatibles de workflow se dejaron como borradores/inactivas. Dry-run de idempotencia: `wouldCreate=0`.

Playwright pasa búsqueda/paginación/filtros reales, roles, PDF inválido y flujo válido completo (borrador invisible → publicar → lector/Viewer/descarga → editar → archivar → no visible); mismo SHA rechazado. Responsive a 375/768/1366 px PASS. Backend 98 PASS/17 omitidos en 21 suites; J9 PostgreSQL 1/1, ACL espacios PostgreSQL 1/1, Prisma generate/validate y migraciones 24/24, builds backend/frontend, typecheck y lint enfocado PASS. J8 sigue `CERTIFIED_WITH_KNOWN_GAPS` (6.070/6.070; `BROKEN=UNKNOWN=UNRESOLVED=0`).

Performance pública, 10 solicitudes por familia: broad 72.93/83.91 ms p50/p95; Sala H 382.49/395.19 ms; expediente 339.09/364.13 ms; carátula 305.99/364.13 ms; fecha 289.15/335.29 ms. La frase media `responsabilidad civil` cuesta 8.353/10.507 ms p50/p95 y queda priorizada para el sprint final de Search. Después del cleanup: Corpus 17.078; Search token states 17.078; tokens 18.799.500; residuos sintéticos 0; rebuild global 0. Dictamen J9: `CLOSED` en DEV. No es gate de producción ni de preproducción. Evidencia completa (ignorada por Git): `_recovery-work/jurisprudencia-j901/`.

## Sprint J9.1 — estado de UX (2026-10-14)

Implementada una pasada de UX de lector/operador, con búsqueda directa, filtros legacy, chips, tarjetas densas, detalle y wrappers de navegación, gestión agrupada y alta más clara. Frontend build/typecheck/lint dirigido y E2E de lector/operador/responsive pasan. Prisma validate/generate y migrate status pasan (24 migraciones al día); PostgreSQL J9 sintético 1/1 PASS. Backend suite bajo guard: 98 PASS/17 omitidos en 21 de 28 suites. Lint global falla por cuatro reglas de React preexistentes en Corpus/Digesto/Revisión. Persisten dos gaps: sumarios reader-visible=0 y activos no publicados=21.119; no equiparar esto con 56 casos de revisión J9. Captura Viewer no confirma render PDF. UAT humana no ejecutada. Evidencia local ignorada: `_recovery-work/jurisprudencia-j91/`; contrato: `BJC-UX-JURISPRUDENCIA.md`.


## Actualización J9.1.1 — 2026-10-14

Jurisprudencia queda `CLOSED` en DEV para los gaps dirigidos de sumarios, cola de revisión, render de PDF, print y contenido largo. De los 6.014 fallos publicados, 0 tienen sumarios; 25.138 sumarios legacy no poseen un enlace jurídico demostrado a ese conjunto. La cola derivada muestra 56 documentos (36 identidad legal + 20 formato); 21.083 históricos/no relacionados están separados. El lector no accede a la cola.

Edge renderizó el PDF real de 3 páginas y el fixture de 1 página en 1366×768 y 1920×1080. La impresión browser invoca `window.print()` con stylesheet verificada; no se automatizó diálogo del sistema. No cambió Search/Viewer core, Corpus, archivos ni schema; conteos de publicación permanecen 6.014/56. No hubo UAT institucional, preproducción ni producción. Evidencia local ignorada: `_recovery-work/jurisprudencia-j911/`.

## estado registrado al cierre de ese corte — Sprint 15.2 fuentes documentales (2026-10-13)

**PARTIAL por validación ambiental; implementación técnica lista en DEV.** Migración `20261013170000_sprint152_document_sources` aplicada y `migrate status` limpio: 24 migraciones. Se respaldó DEV antes de migrar y se validaron hashes de dump/SQL. El modelo de fuentes, escaneo en segundo plano, cambios incrementales, rename inequívoco, manejo offline sin marcar missing, ingesta por el pipeline existente, alias de Search y controles de membership ADMIN pasaron integración sintética. Typecheck, lint y builds backend/frontend PASS. Search general “responsabilidad” devolvió 21 resultados (20 en página) y cero documentos privados; Search verify 17.078 docs/18.799.500 tokens listo, Viewer 6/6. El benchmark metadata sin cambios de 5.000 archivos fue 1.190 ms, cero hashes y cero reingestas.

La suite backend completa terminó: 94 PASS, 19 omitidas, 0 fallos (21 suites PASS, 7 omitidas). No se probó una carpeta UNC real: IT debe habilitar lectura SMB/NTFS para la identidad del backend. La paridad legacy 40/40 está bloqueada porque no existe el SQLite local esperado; no se reporta PASS. No hubo acceso a shares institucionales, preproducción ni producción, ni UAT humana. Evidencia privada local: `_recovery-work/sprint152/`; contrato en `BJC-FUENTES-DOCUMENTALES.md`.

`origin/feature/jurisprudencia` contiene cambios independientes de adquisición y modificaciones divergentes en `BJC-ESTADO-ACTUAL.md` y `BJC-ROADMAP.md`. No se integraron ni sobrescribieron; un futuro cherry-pick/merge puede requerir resolver esos dos documentos manualmente.
## estado registrado al cierre de ese corte — Sprint 15.3 (2026-10-13)

**Sprint 15.3 PARTIAL; implementación de UX y validaciones técnicas PASS en DEV.** /spaces ahora usa layout Copernic de tres paneles con árbol por workspace, carpetas virtuales de fuentes, búsqueda explícita combinada por contenido/nombre, filtros de fuente/carpeta y preview PDF persistente. La página de viewer conserva query, workspace, alcance, página y coincidencia al volver. Sin cambios de schema/migraciones.

E2E Playwright 2/2 PASS, capturas inspeccionadas 1366×768/1920×1080, sin overflow. ACL cruzada A/B: 404; lector autorizado pudo buscar, abrir y descargar. Search general smoke devolvió 21 (20 en página) y ningún privado; proyección 17.078 documentos / 18.799.500 tokens, stale 0, discrepancias 0/100; Viewer 6/6. migrate status limpio, 24 migraciones. Typecheck/build backend/frontend y lint dirigido PASS; cuatro lint errors del repo completo siguen en páginas no modificadas. La paridad legacy 40/40 continúa pendiente por falta del SQLite.

Se mantiene PARTIAL porque offsets de PHRASE no garantizan todavía resaltado de frase exacto y no existen filtros backend de tipo/fecha; la UI omite esos controles. Performance browser en fixture DEV: Search 155 ms, render del primer resultado 12 ms, preview PDF 954 ms, cambio de página 61 ms y F3 10 ms; una muestra, no SLO.

No hubo UAT humano, acceso UNC institucional, preproducción ni producción. Riesgo de integración con feature/jurisprudencia: corpus-search.adapter.ts, workspace-document.service.ts, controller de workspace y documentos maestros generales; no se mergeó esa rama ni se tocó main/dev.

## estado registrado al cierre de ese corte — Sprint 15.3.1 (2026-10-14)

**PARTIAL; filtros backend y spans del extractor implementados en `feature/copernic`.** Workspace Search combina source/folder/type/date en SQL antes de count/paginación; fecha=`decisionDate` inclusiva calendario sin fallback; tipos PDF/TXT por MIME de última versión. `/matches` usa `start/end` sobre texto de página original y comunica truncation. El viewer resalta el fixture de frase exacta y se abstiene ante mapeo PDF.js ambiguo. No se tocó Prisma/schema.

Pruebas registradas: Search filter helpers 10/10 (incluye match contract), Search parser/adapter 34/34, workspace PostgreSQL PASS con fixtures PDF/TXT, source integration 1/1, E2E 2/2, Search verify 17.078 documentos/18.799.500 tokens/stale 0/mismatch 0/100, Viewer general 6/6, Prisma validate/generate y 24 migraciones al día, builds/typechecks frontend/backend PASS. La suite backend completa terminó con 22 suites y 100 tests PASS, 7 suites/19 tests omitidos y 0 fallos. El lint dirigido del backend PASS y la comparación por regla no encontró errores nuevos; el lint del frontend no muestra errores nuevos y conserva un `react-hooks/set-state-in-effect` preexistente en la página de detalle Corpus. Benchmarks y matriz de filtros están en `_recovery-work/sprint1531/`.

Sprint 15.3.1 queda **PARTIAL** hasta ampliar evidencia de alineación extractor↔PDF.js más allá del fixture. No hubo UAT humana, share UNC real, preproducción ni producción. Archivos con posible conflicto respecto de `feature/jurisprudencia`: `corpus-search.adapter.ts`, `workspace-document.service.ts`, `workspace-document.controller.ts`, `BJC-SEARCH.md`, `BJC-ESPACIOS-DOCUMENTALES.md`, `BJC-FUNCIONAL.md`, `BJC-ESTADO-ACTUAL.md` y `BJC-ROADMAP.md`; no se integró esa rama ni se tocaron `dev/main`.

## estado registrado al cierre de ese corte — Sprint 15.3.2 (2026-10-14)

**PARTIAL / PARTIALLY CERTIFIED.** En `feature/copernic` se robusteció el mapping visual Search→PDF.js y el fallback fail-closed. La muestra local fue 25 PDFs/827 páginas (2008–2026), con 138 spans mapeados y 83 sin correspondencia segura; se observaron 0 falsos highlights. Las páginas diferentes (672) difirieron sólo en espacios/saltos de línea. TERM real: 4/25 mapeados; PHRASE: 3/18 spans mapeados. Acentos 5/25, `ñ` 25/25, repetidos 71/75, dos casos multi-item y dos con salto de línea. No se declara cobertura universal.

Verificaciones actuales: Search verify 17.078 docs/18.799.500 tokens, stale 0, mismatch 0/100; Prisma 24 migraciones al día; Viewer general 6/6; Playwright autenticado 5/5; mapper unitario 8 casos/0 falsos; typecheck, lint dirigido y build frontend PASS. Capturas de PDF real muestran canvas con contenido y match activo; resize/viewport equivalente a zoom conservó el highlight. La latencia de mapping fue p50/p95 0,116/0,441 ms por span y 1,744/4,921 ms por página.

No hubo cambios backend, Search, Prisma, migration o ACL. La validación ACL/workspace sigue sustentada por el E2E de Sprint 15.3.1; no se reejecutó en esta sprint. No hubo aceptación humana ni cambios a `BJC-ESPACIOS-DOCUMENTALES.md`. `origin/feature/jurisprudencia` avanzó a `cfc9014` y también toca `CorpusPdfViewer.tsx` y los cuatro documentos generales de esta sprint; no se integró ninguna rama. Evidencia de auditoría y screenshots queda bajo `_recovery-work/sprint1532/`, ignorada por Git.

## estado registrado al cierre de ese corte — Sprint 15.3.3 (2026-10-14)

**Mapping Search→PDF.js: certificado para los spans y clases medidos; cobertura universal sigue PARTIAL.** Sobre los 25 PDFs/827 páginas de baseline se reprodujeron exactamente los 221 estados Sprint 15.3.2 (138 mapeados, 83 `UNMAPPABLE`, cero falsos). El análisis de fallos clasificó 76 diferencias de salto de línea/espacio y 7 límites de item sin separador. El mapper nuevo ubicó 221/221 spans con 0/221 secuencias visibles incorrectas: `DIRECT_EXACT` 35, `NORMALIZED_EXACT` 178, `SEGMENTED_EXACT` 7, `CONTEXT_EXACT` 1. TERM 25/25; PHRASE 18/18; repetidos, acentos y `ñ`: 75/75, 25/25 y 25/25.

La expansión verificó checksums 45/45, 968 páginas y 11 productores. De 141 páginas nuevas: 57 exactas, 83 equivalentes en whitespace, 0 diferencias de glifos en páginas con text layer y 1 página sin capa cuya extracción también estaba vacía. En páginas base, 6 fallan alineación estricta de página completa; una tenía un span y éste quedó localizado por ancla de contexto exacta, pasando auditoría por glifos. Esto limita cualquier afirmación más allá de los spans medidos. Diez casos recuperados pasaron revisión visual autenticada con resize; Search-later y la respuesta Query A demorada después de Query B también pasaron.

Runtime DEV verificado sin reconstrucción: Search projection ready, 17.078 documentos/18.799.500 tokens, stale 0 y mismatch 0/100; Prisma 24 migraciones al día; Viewer 6/6; Search general smoke 21 total/20 devueltos, cero IDs privados y `totalExact=false` por ventana parcial. Workspace PostgreSQL/ACL y E2E privado con preview, filtros y F3/Shift+F3 pasaron. Typecheck, lint dirigido, build frontend y mapper unitario pasaron. Microbenchmark local de una pasada: preparación de página p50/p95 2,785/8,144 ms (alineación incluida, 0,556/0,888 ms); por span 0,052/0,109 ms. El p95 de preparación supera la referencia medida en la pasada base (5,832 ms), por lo que se registra el costo y no se declara paridad de rendimiento. Evidencia y capturas locales ignoradas, sin PDF binario, en `_recovery-work/sprint1533/`.

No se cambió Search backend/AST/SQL/projection, Prisma, schema, migraciones ni ACL. El cambio queda en `feature/copernic`; no se integraron `dev`, `main` ni `feature/jurisprudencia`. UAT humana, validación de OCR/ligaduras/columnas y certificación universal siguen pendientes.

## estado registrado al cierre de ese corte — Sprint 15.4A (2026-10-14)

**PARTIAL.** Se agregó detección de formato por contenido y extracción local para TXT, RTF, DOCX y ODT, junto a PDF existente. Upload privado y fuentes admiten P0 con 20 MiB por archivo; el original permanece protegido e inalterado. Preview textual, Search por tipo y descarga con ACL cubren RTF/DOCX/ODT. DOC legado se detecta y rechaza de forma explícita (`LEGACY_DOC_UNSUPPORTED`). PDFs con páginas de texto escaso quedan `OCR_REQUIRED`, con cualquier texto nativo conservado para Search.

**OCR no implementado en esta PC.** No hay motor/modelo Tesseract español ni herramientas/worker OCR local; no se ejecutó OCR, ni cloud. Sin cola asíncrona, backpressure, retry, cancelación, health ni medida páginas/minuto. No se añadió dependencia, binary, schema o migración, ni se reconstruyó Search global. La siguiente etapa debe resolver primero motor/modelo/local worker y extracción segura `.doc`; no avanzar a 15.4B hasta cerrar ese gate.

Validación: extractor/seguridad 17 tests PASS; backend 23 suites/112 PASS y 7 suites/20 opt-in omitidas; integración Source 2/2 y Workspace/ACL 1/1; Playwright sintético 2/2 PASS (incluye RTF upload/Search/preview/highlight textual/F3/descarga, dos espacios/roles, Viewer y denegación cruzada). Prisma validate/generate y 24 migraciones al día; Search verify 17.078 docs/18.799.500 tokens, stale=0, mismatch=0/100 sin rebuild; Search general 21/20 sin IDs privados; Viewer general 6/6. Backend/frontend build, typecheck y lint dirigido PASS. E2E DEV final midió Search 140 ms, primer resultado 8 ms, primera preview PDF 1.012 ms, cambio de página 49 ms y F3 27 ms. Benchmark extractor (2 warmups, n=20, sintético) p50/p95: TXT 1,783/2,740 ms, RTF 1,611/4,292 ms, DOCX 0,684/1,145 ms, ODT 0,632/1,658 ms, PDF 3,961/6,701 ms; no son SLO ni representan archivos reales. OCR/DOC no medidos. JSON: `_recovery-work/sprint154a/format-benchmark.json`.

Cleanup sintético PASS: 2 workspaces y 3 documentos/blob fixtures eliminados; conteos finales: 17.078 documentos, 17.098 archivos, 17.685 ingestions y 17.100 extracciones; proyección 17.078 documentos/18.799.500 tokens, stale=0, mismatch=0/100 y `rebuiltDocuments=0`. La DB pasó de 4.800.852.451 a 4.835.185.123 bytes físicos (+34.332.672 por bloat de suites sintéticas); no hubo residuo lógico, pero no se declara igualdad byte a byte. No se usó share UNC institucional, corpus real como fixture, producción, preproducción ni UAT humana. Evidencia ignorada por Git: `_recovery-work/sprint154a/`; matriz contractual en `BJC-PROCESAMIENTO-DOCUMENTAL.md`.

Colisión: `git fetch origin --prune` actualizó `origin/feature/jurisprudencia` a `566e4b11ab4395416d7cf2b65bfc8e32cf2ffb3a` (inicio observado: `ae377529097b5e87e1ea10a8c5f784a09644ed7b`). Se detectó solapamiento de rutas con esta sprint en Search/Corpus Workspace, UI y documentos compartidos; el reporte completo está en `_recovery-work/sprint154a/collision-report.json`. No se integró ni se modificó esa rama.
## Sprint 15.4A.1 — cierre técnico local (2026-10-14)

**Estado: CLOSED en DEV local; no es aceptación humana ni habilitación productiva.** Se cerraron OCR local de PDF escaneado/híbrido, worker durable acotado e extracción OLE `.doc` local segura. Tesseract 5.4.0 con `spa`/`eng`, Poppler 25.07.0 y LibreOffice headless 26.8.1.1 pasaron fixtures sintéticos; DPI elegido 250. El worker procesa un job a la vez, limita a dos intentos y recupera leases vencidos. La extracción DOC no abre Word, no ejecuta macros y no actualiza vínculos remotos.

La migración aditiva `20261014110000_sprint154a1_local_document_processing` está desplegada sólo en DEV. Prisma reportó 25 migraciones al día. La verificación de Search posterior al cleanup mantuvo 17.078 documentos y 18.799.500 tokens, stale=0, mismatches=0/100 y rebuiltDocuments=0; filas Corpus: 17.078 documentos, 17.098 archivos, 17.685 ingestas y 17.100 extracciones. Cleanup E2E final: cero workspaces/documentos sintéticos restantes y storage aislado eliminado.

La suite backend completa final pasó 128 pruebas en 27 suites; 20 pruebas opt-in quedaron omitidas y siete suites no aplicaban. Después se repitieron la integración PostgreSQL Workspace extendida con DOC (1/1), Source (2/2) y el E2E UI completo (1/1). Backend build/typecheck/lint y frontend typecheck/build/lint pasaron. La E2E mantuvo health y Search disponibles durante OCR, encontró el texto al completar el job, probó DOC/RTF, descargas y ACL, navegó F3/Shift+F3 y no dibujó highlight visual OCR. Benchmark DOC 10/10: media 35,35 s, p50 30,48 s, p95 57,57 s; es una limitación de rendimiento para carga masiva. Mantener local-only; para detalle, límites y próximo alcance consultar `BJC-PROCESAMIENTO-DOCUMENTAL.md` y `BJC-ROADMAP.md`.

Collision audit final después de `git fetch origin --prune`: `origin/dev`=`f7e37bc12436110191da15121bf047a0184e2e5a`, `origin/feature/jurisprudencia`=`e27fb1547c128b2a5976ad160a1b4eb7e4b95341`, `origin/feature/copernic` antes del commit=`928ba3c1398f924e53f7af02870f2dc9df09e8d8`; merge-base de las ramas=`origin/dev`. La rama remota tiene 98 rutas divergentes y ocho coinciden con esta sprint: `AGENTS.md`, `schema.prisma`, `with-dev-db-guard.cjs` y cinco documentos generales. El riesgo de integración es **ALTO** por schema/migraciones y contratos/documentación compartidos; package.json y la migración de workflow sólo cambian en jurisprudencia, mientras este sprint agrega una migración local distinta. No se mergeó ni modificó esa rama; resolver schema, migraciones y rutas compartidas durante una integración coordinada.
## Sprint 15.5 — estado registrado al cierre de ese corte (2026-10-14)

Search + Viewer: **CERTIFIED_WITH_KNOWN_LIMITATIONS para beta técnica controlada en DEV**. Golden Search 319/319; real sample 300/300 invariantes; Workspace/ACL PostgreSQL 1/1; E2E piloto 5/5 y workspace 2/2; paginación 325/325 sin duplicados/faltantes. Baseline posterior al cleanup: 17.078 documentos, 17.098 archivos, 198.129 páginas, 17.685 ingestas, 18.799.500 tokens, stale=0, mismatch=0/100, workspaces privados=0. Prisma: 25 migraciones al día; no hubo migration/schema/dependency change.

El highlight visual OCR no está certificado. UAT humana, preproducción, matriz de seguridad XSS/SQLi exhaustiva y auditoría WCAG completa siguen pendientes. Lint global frontend conserva errores en páginas administrativas no tocadas. Evidencia y limits: `BJC-CERTIFICACION-SEARCH-VIEWER.md` y `_recovery-work/sprint155/`.

## Sprint 15.6 — estado UX de espacios documentales (2026-10-14)

En `feature/copernic` se trabajó sólo la UX local de Copernic: entrada directa para membresía única, selector humano multi-dependencia, nombres de Sala/Juzgado, árbol compartido expandible, copy claro de búsqueda/preview/errores/procesamiento y destino/acceso compartido antes de upload. Se corrigió una carrera de respuestas viejas que podía ocultar una membresía recién agregada; el Viewer ahora oculta búsqueda/descarga cuando devuelve una denegación. «Carga manual» se presenta como «Documentos cargados».

Validación propia de esta sprint: Playwright autenticado 2/2 PASS (sin membresía, una y varias dependencias, administración de roles, upload, Search, filtros, PDF/DOC/RTF, OCR, Viewer y denegación 404 genérica). La matriz 1366×768, 1440×900, 1536×864, 1600×900, 1920×1080, 1920×1200 y 2560×1440 tuvo cero overflow horizontal y tres paneles visibles; capturas clave inspeccionadas. Typecheck, lint dirigido y build frontend PASS. Prisma validate/generate y migrate status PASS (25 migraciones); Search projection verify: 17.078 documentos, 18.799.500 tokens, stale 0, mismatch 0/100, rebuild 0; golden Search 1/1 y Source PostgreSQL 2/2 PASS.

La integración PostgreSQL Workspace se ejecutó dos veces y falló en la expectativa OCR `attemptCount=1` (observado 2); ambas corridas limpiaron sus filas. Había un backend activo en 4001 mientras la prueba usaba el DB compartido; que otro worker haya reclamado el job es una explicación posible, no quedó confirmado. No se detuvieron procesos activos. El E2E completo confirmó ACL y Viewer en su propia corrida aislada. Después de cleanup, el baseline volvió exactamente a 17.078 documentos/17.098 archivos/198.129 páginas/17.685 ingestas, cero registros privados/workspaces y storage de prueba eliminado.

**Dictamen esperado: PARTIAL para la misión integral.** Se verificó por código/modelo que `WorkspaceDocument` no tiene propietario personal ni ACL por carpeta; el acceso actual corresponde a todas las membresías activas de la dependencia. No se expusieron botones personales/restringidos que pudieran prometer un permiso inexistente. No hubo cambios de backend, Search core, Viewer core, OCR, Prisma o migraciones. UAT humana y toda certificación personal/restringida siguen pendientes. Ver `BJC-UX-ESPACIOS-DOCUMENTALES.md` y `_recovery-work/sprint156/`.

## Cierre Sprint 15.6.1 — 2026-10-14 (estado registrado al cierre de ese corte)

**CLOSED técnicamente en DEV local; UAT humana, UNC institucional, preproducción y producción siguen pendientes.** `feature/copernic` incorpora propiedad personal global por usuario y ACL heredable por carpeta para dependencias. Los dos cambios Prisma son aditivos; DEV está al día con 27 migraciones. El backend aplica el permiso antes de árboles, Search/count, metadata, matches, Viewer y descarga, y revoca grants en vivo. Fuente sincronizada no se privatiza ni se republica con las rutas de documentos personales.

La E2E final de Playwright pasó 1/1 y los tamaños 1366×768, 1440×900, 1536×864, 1600×900, 1920×1080, 1920×1200 y 2560×1440 no tuvieron overflow horizontal. Integración ACL 1/1; Source PostgreSQL 2/2; Workspace PostgreSQL 1/1 en seis corridas consecutivas tras aislar queue/storage de pruebas; Search golden 319/319; build/typecheck/lint focalizado y Search Verify PASS. Se agregó una regresión para rechazar un hijo compartido dentro de un padre restringido hasta que se amplíe primero el permiso del padre.

El OCR `attemptCount=2` histórico ocurrió mientras un backend ya existente escuchaba 4001; la suite compartía la cola `default`. La prueba ahora usa una cola por corrida y storage aislado. Seis repeticiones pasaron con intento 1. Esto prueba determinismo bajo aislamiento; no reconstruye la intercalación histórica y no atribuye un defecto al worker de producción. La limpieza posterior dejó cero filas E2E y borró cuatro blobs sintéticos; baseline Search: 17.078 documentos, 17.098 archivos, 198.129 páginas, 17.685 ingestas, 18.799.500 tokens, stale 0, mismatch 0/100 y rebuild 0. Evidencia local: `_recovery-work/sprint1561/`.

## INT-1S.4 — estado registrado al cierre de ese corte de Search (2026-10-15)

**Acelerador adaptativo por chunks REJECTED; INT-1S e INT-1R continúan BLOCKED.** La garantía formal de chunks con 2048/overlap 127 cubre frases normalizadas hasta 128 caracteres; para frases mayores, anchors literales de hasta 128 caracteres preservan candidatos y requieren verificación exacta completa. La prueba sintética cubrió límites y frases 129/301/1000. En el Corpus DEV, 2048 y 1024 produjeron el total histórico 202 para `falta de servicio`, pero `responsabilidad civil` agotó 4 s en ambas. 1024 redujo los bloques compartidos del plan de `falta` a 3.981 desde 33.211, pero elevó el almacenamiento temporal a 833,44 MiB y la preparación total observada a ~24,4 min; 512 no se intentó. Cero cambios de código Search, schema o migración; se eliminaron los objetos UNLOGGED y se verificó cero residuo. Los 13 cambios previos del worktree se conservaron; DEV no se promovió y UX-2 no se inició. Evidencia: `_recovery-work/integration-int1s4/final-summary.json`.

Recomendación para decisión futura: INT-1S.5 — investigar postings dedicados de substring/posiciones de caracteres; esta misión no inicia esa implementación.

## SEARCH-SEMANTICS-AUDIT-1 — 2026-10-15

**Dictamen: SUBSTRING_UNCERTAIN.** El código actual de Corpus usa `ILIKE %literal%`, pero no hay requisito local que demuestre que la coincidencia parcial dentro de palabras sea intención de Biblioteca/Civil. La ayuda llama a las comillas «Frase exacta» sin explicar el comportamiento parcial. El PHP histórico de Jurisprudencia delimitaba términos simples con espacios y documentaba `%` como comodín; esto no demuestra el runtime de Copernic, que no está disponible para prueba. Golden 319/319 no tiene casos dependientes de subcadena. En un dump local de 2026-10-13, “responsabilidad civil” dio 5.372 resultados actuales y 5.364 con límites léxicos (8 current-only); “falta de servicio”, 202 y 194 (8 current-only). De 100 frases reproducidas por hash/cantidad, 91 conjuntos fueron idénticos y 9 cambiaron. Es comparación semántica offline, no benchmark del motor. No se cambió Search ni se accedió a DB; falta UAT de Biblioteca/Civil. Evidencia y pack: `_recovery-work/search-semantics-audit1/`. Mantener INT-1S e INT-1R esperando decisión humana; motor diferido, DEV no promovido y UX-2 no iniciado.
## SEARCH-CONTRACT-CHANGE-1 — decisión y estado (2026-10-16)

La validación funcional resolvió SUBSTRING_UNCERTAIN como SUBSTRING_ACCIDENTAL (confianza alta): TERM simple y PHRASE requieren unidades léxicas completas; los comodines explícitos existentes conservan prefijo/sufijo/contiene. Copernic tampoco encontraba CIVIL dentro de CIVILIZACIÓN. No se aplica stemming.

La proyección DEV fue verificada: PostgreSQL 16.15 en 127.0.0.1:55432, DB buscador_juridico_civil_dev, rol bjc_dev; 28 migraciones, 17.078 documentos, 18.799.500 tokens, lista y sin discrepancias en la muestra de 100. El modelo de tokens no contiene posiciones. Prototipo FTS simple con puntuación conservada: 16/16 fixtures PASS; primer conteo live de frase lexical: 5.364 documentos. La medición de rendimiento/indexación, integración del adapter, Golden actualizada, ACL, paginación/Viewer y build permanecen pendientes. El backup previo a la evaluación estructural de DEV está en curso; no se ha aplicado migración ni alterado el adapter.

## SEARCH-SEMANTICS-AUDIT-1 — cierre con validación humana y prototipo lexical (2026-10-16)

La clasificación inicial `SUBSTRING_UNCERTAIN` queda resuelta por validación directa de la persona usuaria: `SUBSTRING_ACCIDENTAL`, confianza alta. El contrato acordado es TERM/PHRASE con unidades léxicas completas, sin stemming; los comodines explícitos mantienen sus modos. La persona informó que Copernic no encontraba `CIVIL` dentro de `CIVILIZACIÓN`; el runtime local de Copernic no estuvo disponible para reproducirlo.

El FTS simple de un vector fue descartado por falsos negativos en documentos extensos (5.363/5.364 para “responsabilidad civil”; 149/194 para “falta de servicio”). Un prototipo híbrido FTS por ventanas recuperó esos dos totales y pasó 23/23 fixtures, pero su p95 combinado para “responsabilidad civil” fue 2.467 ms (sobre el gate de 2 s); “falta de servicio” fue 437 ms. La paridad de IDs/100 consultas y concurrencia no está certificada. Ningún adapter, Golden, schema o migración de producto fue modificado; los objetos FTS de prueba fueron temporales y revertidos. INT-1S sigue bloqueado por rendimiento. Artefactos: `_recovery-work/search-semantics-audit1/` y `_recovery-work/search-contract-change1/`.

## SEARCH-SEMANTICS-AUDIT-2 — estado registrado al cierre de ese corte (2026-10-16)

**PARTIAL / WAITING HUMAN COPERNIC RUNTIME TEST.** Se reabrió la clasificación previa SUBSTRING_ACCIDENTAL / confianza alta porque una segunda fuente anónima recuerda lo contrario en TERM: CIVIL sí aparecía dentro de CIVILIZACIÓN y se resaltaba sólo CIVIL. H1 mantiene el recuerdo anterior: no aparecía; también recuerda TERM y PHRASE léxicos. H2 todavía no puede confirmar la semántica de PHRASE y no aporta semántica completa de comodines.

La clasificación histórica vigente es SUBSTRING_UNCERTAIN por recuerdos humanos contradictorios. TERM=UNKNOWN; PHRASE=UNKNOWN y prueba directa PENDING; PREFIX/SUFFIX/CONTAINS=UNKNOWN. La suite Golden 319/319 no distingue la intención histórica: sus casos no dependen de coincidencias parciales internas. La inspección local no encontró runtime, índice/configuración ni captura Copernic para reproducirlo.

La decisión de motor está DEFERRED. No ejecutar SEARCH-ENGINE-EVAL-2 ni PGroonga hasta contar con evidencia directa y clasificar TERM y PHRASE separadamente. Sin cambios de producto ni acceso a DB en esta auditoría; se preservó el worktree preexistente. Pack neutral y artefactos: _recovery-work/search-semantics-audit2/.

## SEARCH-SEMANTICS-AUDIT-2 — estado final del contrato (2026-10-16)

**CLOSED para el objetivo de producto:** COPERNIC_PREFIX_EXACT_PHRASE. TERM simple es PREFIX; PHRASE entre comillas es EXACT_LEXICAL_PHRASE. La incertidumbre semántica del target queda cerrada por documentación oficial y decisión explícita. Runtime histórico institucional no instalado/ejecutado localmente; no se afirma prueba directa. El estado intermedio SUBSTRING_UNCERTAIN y las memorias H1/H2 quedan preservados.

H2 reportó frase exacta "responsabilidad civil" con ambas palabras resaltadas y ausencia de superresponsabilidad civilizado; es observación humana sin captura. Su posible recuerdo de infix RESPONSABILIDAD queda como conflicto de baja confianza, no como contrato. Fuentes oficiales: [Copernic Prefix Search](https://copernicsearch.freshdesk.com/en/support/solutions/articles/47001129478-prefix-search-how-it-works); [CDS 8 Quick Start Guide](https://copernic.com/wp-content/uploads/2024/01/CDS8_quick_start_guide.pdf); [Copernic Search Operators](https://copernicsearch.freshdesk.com/en/support/solutions/articles/47001112953-refine-search-with-search-operators); [Copernic Release History](https://copernic.com/en/desktop/release/). Alcance: _recovery-work/search-semantics-audit2/external-copernic-evidence.json.

Search no se implementó y todavía difiere del target: plain TERM actual puede ser substring arbitraria; Corpus PHRASE admite secuencia literal sin límites léxicos, mientras el adapter moderno Jurisprudencia aplica límites por espacios. Golden sigue en 319 (0 explícitamente dependientes de partial-word), sin cambios. Motor DEFERRED y EVAL-2 no iniciado; benchmarks substring anteriores no comparan el contrato nuevo. INT-1S bloqueado por implementación/rendimiento, no por incertidumbre semántica; INT-1R espera Search; DEV no promovido; UX-2 no iniciado. Sin DB ni cambios de producto. Próximo sprint: `SEARCH-CONTRACT-COPERNIC-1`, con PostgreSQL primero bajo el contrato acordado.


## SEARCH-CONTRACT-COPERNIC-1 — resultado histórico (2026-10-16)

**PostgreSQL REJECTED; contrato semántico CLOSED; implementación Search BLOCKED.** Baseline PostgreSQL DEV local, sólo lectura: Corpus lógico 17.078, elegibles 17.077, proyección 17.078 documentos/18.799.500 tokens; J8 6.070 documentos únicos, 6.014 publicados activos y cohorte review 56 (36 identidad + 20 representación), sin BROKEN/UNKNOWN/UNRESOLVED.

Candidato A trigram document-wide + regex: timeout de 2,1 s a los 2.114 ms para “responsabilidad civil”, sobre máximo 2 s. Candidato B token projection + regex y verificación de searchText: timeout a los 2.112 ms. Ambos REJECT_PERFORMANCE, sin igualdad de IDs certificada. Candidato C página/FTS NOT_RUN: 198.129 páginas / 408.693.253 bytes; 16.683 de 17.077 elegibles tienen página no vacía en la última extracción; 394 carecen de ella. No hay índice FTS/posicional de páginas y el intento FTS anterior perdió 1 y 45 IDs en las frases críticas; el híbrido completo llegó a 2.467 ms p95 para “responsabilidad civil”.

No se implementó Search; Golden sigue 319 sin cambios; no hubo cambios de producto/schema, migraciones, escrituras DEV, backup, build ni pruebas finales de producto. Se limpiaron las rutas temporales del DB guard y su SHA volvió al estado preexistente. Próxima evaluación: SEARCH-ENGINE-EVAL-2 bajo el contrato nuevo. INT-1S BLOCKED BY ENGINE; INT-1R BLOCKED; DEV NOT PROMOTED; UX branch UNTOUCHED. Artefactos: `_recovery-work/search-contract-copernic1/`.

## SEARCH-ENGINE-EVAL-2 — estado registrado al cierre de ese corte (2026-10-16)

Contrato de búsqueda: CLOSED (COPERNIC_PREFIX_EXACT_PHRASE). PostgreSQL search: REJECTED por rendimiento y falta de certificación exacta; PostgreSQL sigue como source of truth. OpenSearch 2.19.6: EVALUATION PASSED y ADOPT como motor candidato para integración. No está integrado ni habilitado en el producto.

Evidencia sobre 17.077 documentos Search-eligible: indexación completa, missing/extra/duplicates = 0; 100/100 frases y 14/14 prefijos con igualdad exacta de IDs; Golden 319/319 y fixtures nuevas 12/12; critical combined p95 máximo 109,65 ms; ACL sin leaks; rebuild exacto. El índice medido ocupa 1,053 GB y reconstruyó en 4m44s.

Quedan para el sprint de integración: autenticación/TLS, sync durable de contenido, estado de publicación y ACL, fail-closed, índices versionados/alias, supervisión y observabilidad. INT-1S: WAITING ENGINE INTEGRATION. INT-1R: BLOCKED. DEV: NOT PROMOTED. UX-PREP: CLOSED / UNTOUCHED. No hubo cambios de producto, writes DEV, commit ni push. Evidencia: _recovery-work/search-engine-eval2/.


## SEARCH-ENGINE-INTEGRATION-1.1 — certificación final (2026-10-16)

**DECISIÓN: BLOCKED.** OpenSearch 2.19.6 sigue operativo como índice derivado local; PostgreSQL conserva la autoridad. El rebuild versionado dejó el alias galilei-search-active en galilei-search-v001-20261016t162707813z-1dbe2406; el verificador final comparó 42.180/42.180 IDs (Corpus 17.077/17.077), con faltantes, extras y duplicados = 0. La recuperación ante caída y la carrera controlada de rebuild también pasaron: commit/outbox durables, 0 updates perdidos, replay de create/update, alias actualizado y backlog final 0.

Golden: 325/325 (319 baseline + 6 casos); 100/100 sets exactos de frases y 14/14 prefijos; frases críticas con igualdad de IDs. La medición de 30 ejecuciones fue por adapter OpenSearch + hidratación PostgreSQL, no por el endpoint NestJS completo: “responsabilidad civil” p50/p95/max 202,79/220,07/301,44 ms; “falta de servicio” 96,60/103,92/107,46 ms; cero timeouts.

El corte de rutas sigue parcial: hay fallback/ejecución legacy para algunos caminos y filtros/sorts avanzados. ACL y publicación dentro del engine, fail-closed de la API, ruta HTTP completa, suite mixta/concurrencia, handshake TLS/auth y replay de migración limpia siguen sin certificación. Por eso no hubo commit, push ni promoción a DEV. Rama integration/galilei-beta; HEAD local/remoto de integración permanece 325ceb4c3c8538d9b50a66c403b1b227cdc66ea6. La rama UX no fue editada. Auditoría: _recovery-work/search-engine-integration1/continuation-audit.json.

## SEARCH-ENGINE-INTEGRATION-1.2 — auditoría de corte (2026-10-16)

**BLOCKED; sin commit/push/promoción.** La verificación actual conserva 42.180/42.180 IDs exactos, alias `galilei-search-active`, schema v1, OpenSearch green y outbox 0/0. La suma representa Corpus 17.077 más 25.103 Sumarios activos; no representa todas las Sentencias públicas.

El censo de sólo lectura sobre DEV encuentra 27.133 Sentencias activas, 6.014 publicadas y 21.119 no publicadas/en revisión. Las 6.014 publicadas no tienen Sumarios activos, mientras que los 25.103 Sumarios activos indexados no están publicados junto con su Sentencia. La prueba HTTP pública devolvió 2 resultados legacy publicados/activos y 0 OpenSearch para una consulta crítica; no hubo fuga de borradores en esas dos filas, pero sí falta de cobertura en la proyección. Al hacer OpenSearch inaccesible, `/api/public/busqueda` devuelve 503 controlado sin stack, aunque el controller también invoca el servicio legacy.

Prueba parcial de publicación: una Sentencia activa no publicada seleccionada de DEV fue consultada por su número en el endpoint público; respuesta total 0 y candidato ausente (1 fixture, no matriz completa).

Calidad ejecutada: `tsc --noEmit` PASS; build PASS; Jest con DEV guard PASS (32 suites/162 tests, 9 suites/21 tests omitidos). ESLint de 42 archivos Search reportó 806 errores y 0 warnings; el nuevo censo sí pasa lint y no hubo formateo masivo. Faltan cortes de rutas, filtros/sorts, ACL/publicación engine-side, sync de OCR/DOC/metadata, certificar Golden/frases/prefix por HTTP, concurrency/performance HTTP y Viewer/UTF-16 completos. No tocar origin/dev, main ni ramas UX.

## Evidencia de checkout limpio — PREPROD-UAT-PREP-1 (2026-10-18)

En worktree detached del commit de preparación `25b6a83ed5867bce8e6b296d0da108db0b3ae7c4`: `pnpm install --frozen-lockfile` PASS para backend y frontend; `pnpm prisma:generate` PASS (sin conexión DB); backend `pnpm build` PASS; frontend `pnpm build` PASS con origin HTTPS sintético `.invalid`; frontend preprod env tests 5/5 PASS; guard frontend PASS. Con `NODE_OPTIONS=--experimental-vm-modules`, la suite segura sin DB/fixture legacy corrió 36 suites PASS / 1 SKIP; 231 tests PASS / 9 SKIP.

La invocación total de Jest en checkout vacío no quedó certificada: ocho suites de integración requieren `DATABASE_URL` y un DB aislado; no se usó el DB canónico DEV porque esta misión lo prohíbe. El suite legacy SQLite es opt-in y necesita el fixture histórico fuera del repositorio; no se copió ni accedió a ese corpus. Se excluyeron esos nueve suites del resultado seguro. No hubo writes a PostgreSQL ni a OpenSearch en la fase de build/test. PostgreSQL DEV sólo se consultó en la verificación read-only ya registrada (31 migraciones); no es PREPROD.

Resultado de fase: paquete de preparación listo para revisión/infra, no deploy-ready. PREPROD sigue `NOT PROVISIONED`, backup/restore PREPROD `NOT PROVEN`, smoke real `NOT RUN`, UAT institucional `NOT STARTED`; no invitar usuarios.

## JURISPRUDENCIA-COLLATION-V4-IMPLEMENT-1 — cierre (2026-10-20)

**PASS; rama candidata lista para commit/push, sin promoción ni cutover de alias.** En `feature/jurisprudencia-collation-v4-implement1`, basada en `cd5e9e2030dc4e6a0394a1a8175f9d5e71f29af8`, se creó y reindexó el shadow `galilei-search-v004-20261020t094732495z-6015e394` con 69.313 documentos. Paridad completa de IDs y `_source`: 0 diferencias; Golden interno de 7.694 documentos: 0 diferencias posicionales ASC y DESC; matching, paginación y performance técnica pasan. OpenSearch 2.19.6 está GREEN con `analysis-icu` 2.19.6 / ICU4J 75.1 y heap de 2 GiB.

V3 `galilei-search-v003-20261017t232432555z-a6af18cb` conserva 69.313 documentos y mapping; `galilei-search-active` sigue apuntando exclusivamente a V3. V4 no está activo. La matriz privada se cerró mediante fixtures sintéticos en PostgreSQL DEV y siembra temporal de 10 documentos sólo en el índice físico V4: Search privado de workspace, carpeta restringida, no miembro (404 sin revelar existencia), espacio compartido y personal pasaron. La paginación sobre 5 candidatos brutos autorizó exactamente 2 antes del conteo/página, sin devolver IDs denegados. Nueve solicitudes HTTP midieron mediana 20,30 ms y máximo 48,76 ms. La limpieza dejó V4 en 69.313, outbox en 217.809/0 pendientes/0 fallidos y cero residuos. Evidencia: `_recovery-work/jurisprudencia-collation-v4-implement1/private-http-v4.json` y `cleanup-verification.json`.

La latencia medida en el shadow fue p50/p95 7,90/8,87 ms ASC y 7,34/11,51 ms DESC (20 muestras después de dos warmups), cero HTTP 503, página profunda de 5.000 en 45/37 ms, sin materialización completa. Capacidad final: 82,26 GiB libres, cero flood blocks. V3 permanece como rollback y no se cambió el alias. La suite completa finalizó con 49 suites y 344 tests PASS, 10 suites y 24 tests SKIP; typecheck, build, lint de 14 archivos TypeScript, Node syntax checks, `git diff --check` y secret scan de 22 archivos pasan. Review independiente sigue pendiente; no hacer cutover.

## JURISPRUDENCIA-V4-FRESH-BOOTSTRAP-TOOLING-1R — checkpoint 2026-10-21

**En ejecución; todavía no certificada ni promovida.** El candidato recuperado está en `feature/search-fresh-v4-bootstrap1r`, sobre `origin/dev=ebefee54a5208187b7f77b84d71d7addd043f653`; conserva cambios locales sin commit. `origin/main=83947656420a9d6f6c3cfb12b353eb7f2c293a28` no cambió. La búsqueda principal V4 y su alias activo permanecen fuera del alcance de las escrituras de esta misión.

El runtime de prueba es aislado (OpenSearch 2.19.6, `analysis-icu` 2.19.6, heap 2 GiB, HTTP/transport `127.0.0.1:19200/19300`, UUID `NHj1BIfrQ2C4Dolb4yJC9A`). PostgreSQL fue validado por el guard como `bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev`. El índice candidato es `galilei-search-v004-20261021t082000000z-1a2b3c4d`; su estado persistido es `PROJECTING`, H_BOOT `223156`, alias `NONE`. La proyección sólo lee PostgreSQL; no se ejecutaron migraciones ni hubo escrituras de DB.

La ejecución se pausó cuando la memoria libre cayó bajo 512 MiB. La reanudación valida y reutiliza el índice parcial con upsert idempotente, sin borrarlo; el estado registra cursor confirmado y conteos acumulados por cada origen para continuar desde la última página completa. El tamaño de página es 10; `ts-node` usa `transpile-only` y heap Node limitado a 160 MiB. Siguen pendientes proyección completa, paridad de IDs y fuentes, Golden ASC/DESC, Search público/privado, lifecycle, restart, suite/build final y revisión independiente. No hubo commit, push, promoción, migración ni acceso a Sytec10. Evidencia: `_recovery-work/jurisprudencia-v4-fresh-bootstrap-tooling1r/`.

## Sprint 7 — ingreso institucional (2026-10-26)

Implementación candidata en `feature/institutional-ingestion-suite-7`, creada desde `feature/jurisprudential-evolution-suite-6` en el SHA certificado `da22ffba986ebd3f7ca5f065cfe5e81b59c7bb23`. El flujo añade una cola auditada para recibir un PDF institucional, validar tamaño/estructura, calcular SHA-256, reutilizar duplicados, extraer texto o marcar `OCR_REQUIRED`, confirmar metadatos, vincular una sentencia seleccionada o crear un borrador explícito. El borrador queda `BORRADOR`, `publicado=false`, `publishedAt=null`; no se activa publicación automática.

La fuente sigue siendo PostgreSQL, los bytes siguen en el almacenamiento content-addressed del Corpus, y Search sigue siendo derivado. Los roles que pueden escribir son `ADMIN`, `OPERADOR` y `JURISPRUDENCIA`; `REVISOR` puede leer y `LECTOR` recibe 403. Validación aislada local: PostgreSQL QA 16 en `127.0.0.1:55434`, OpenSearch QA 2.19.6 en `127.0.0.1:19200`, 38 migraciones al día, paridad Search 10/10, suite integración 10/10, smoke autenticado 26/26 y limpieza con cero residuos. Suite completa: 597 PASS/10 SKIP; regression Playwright de investigación: 22/22; lint/typecheck/build/audit pasan. El chunk PDF.js conserva su aviso existente.

El chequeo de solo lectura sobre el PostgreSQL DEV principal confirmó identidad y conectividad; la versión de schema presente allí informa cinco migraciones pendientes respecto de ese checkout y no se aplicaron. OpenSearch principal siguió GREEN con V4 activo y 69.313 documentos. No se hicieron escrituras en DB/Corpus/Search principales, ni cambios a `dev`/`main`, ni acceso o deploy a Sytec10. La promoción queda fuera de Sprint 7. La publicación de la rama feature y el estado de CI del SHA exacto son gates separados; ver la evidencia reproducible en `_recovery-work/galilei-institutional-ingestion-suite7/evidence/`.

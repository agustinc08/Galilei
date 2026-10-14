# Decisiones y contratos vigentes

**Estado del documento:** actualizado tras Sprint 12.3; distinguir diseño, implementación y gates de integración.

**Adenda Sprint 8 (2026-10-07):** se incorporó en DEV el primer corpus institucional local de 10.732 hashes únicos; los roots PDF fuente permanecen read-only, y todos los documentos quedaron `INTERNAL`/`NO_REVIEWED`/`REVIEW_REQUIRED`. La segunda pasada reutilizó los 10.732, con cero documentos/blob/páginas duplicados. La migración `20261007220000_sprint8_corpus_title_trgm` añade un GIN trigram sobre la expresión normalizada de `title`, justificado por EXPLAIN: filtro de carátula pasó de 3.613,8 ms a 0,333 ms. `CorpusSearchSourceAdapter` usa el `searchText` normalizado directamente para dejar utilizable su índice trigram. Estas mediciones son locales DEV, no SLA.

**Adenda Misión 7 (2026-10-07):** CSJN Tribunales Federales y Nacionales es la superficie actual a la que redirige la URL histórica CIJ. La ruta PDF observada está disallow en `csjn.gov.ar/robots.txt`; por tanto no implementar crawling/descarga sin un canal autorizado que resuelva esa restricción. No equiparar acceso HTTP público con autorización institucional de ingesta. No se ejecutó piloto real.

**Adenda Misión 7.1 (2026-10-07):** se implementa recepción de paquetes autorizados por JSON/CSV/carpeta y flujo validate/dry-run/import/retry con receipt SHA; ZIP debe extraerse antes. Se agrega fan-out de Search y lectura/descarga de Corpus con ACL de visibilidad. Todo validado en DEV sintético; ningún documento institucional real. El canal no revoca el NO GO para scraping público ni sustituye aprobación institucional de procedencia, permisos, anonimización y clasificación.

## Stack y límites

- Stack objetivo: Next.js, React, TypeScript, NestJS, Prisma y PostgreSQL 16; pnpm es el gestor del proyecto.
- PostgreSQL nativo en Windows está operativo para DEV en `127.0.0.1:55432`, base `buscador_juridico_civil_dev`, usuario `bjc_dev` sin SUPERUSER; `pg_trgm 1.6` está habilitada. Toda escritura local se limita a ese destino mediante el guard del backend. No usar producción ni destinos remotos.
- SQLite legacy = referencia/fixture; no arquitectura final. Leerla `read-only`, `immutable`, `query_only`.
- No producción, bases remotas/institucionales, Docker o WSL en esta fase. No importar automáticamente `tb_microisis`.

## Búsqueda

- Un parser y un `SearchQueryAst` compartidos por adaptadores SQLite y PostgreSQL; no crear `PostgresParser` ni duplicar gramática/normalización.
- Contrato: `SearchSourceAdapter.search(query: SearchQueryAst, context: SearchContext): Promise<SearchResultPage>`.
- Operadores legacy: `*` = AND, `+` = OR, `-` = NOT. Precedencia documentada: `NOT > AND > OR`.
- `%` inicial/final representa SUFFIX/PREFIX conforme al parser existente; el adapter sólo traduce `matchMode` del AST.
- AST cubre TERM, PHRASE, AND, OR, NOT, campo y matchMode `contains`/`prefix`/`suffix`.
- `ñ != n`; tolerar acentos vocálicos conforme a las pruebas; mayúsculas/minúsculas equivalentes. No aplicar `unaccent` sin preservar Peña/Pena.
- SearchDocument es un read model reconstruible; no sustituye entidades fuente ni curaduría.
- Ranking PostgreSQL puede continuar a integración en DEV: score lógico constante se precomputa cuando cada rama coincidente garantiza una literal positiva; se mantiene score variable en expresiones ambiguas. La ruta moderna de sufijo simple usa un CTE `UNION` para aprovechar GIN trigram existentes. Medición 5.4: mediana p50 por familia 1.621 s → 0.709 s; 40/40 compatibilidad. Producción espera SLO, corpus de escala y concurrencia.
- SQL parametrizado para valores, whitelist interna para campos/orden. ACL/visibilidad y publicación antes de ranking, snippets, facets, total, preview y PDF.
- Benchmark sin modificar `benchmark-busqueda.json`; paridad sólo sobre el mismo conjunto de IDs. Diferenciar resultados legacy/modernos y reportar IDs además de conteos.

**Adenda Sprint 12.3 (2026-10-08):** `/api/busqueda/avanzada` enruta las familias estándar a `FederatedSearchService`/Search V2; no inicia el executor legacy y conserva el DTO/tracking. Filtros estructurados no cubiertos conservan fallback hybrid hasta demostrar paridad. El pool de Corpus queda acotado a 8 conexiones por instancia; la carga DEV a 20 usuarios no mostró error, aunque Prisma tuvo cola y la prueba no representa una red compartida. PHRASE usa candidatos tolerantes a puntuación seguidos de verificación exacta; PREFIX/SUFFIX/SHORT utilizan la proyección Corpus existente. No se creó proyección ni migración Jurisprudencia, ni se añadió índice Sprint 12.3. Evidencia: docs 117–125; gate READY WITH NON-BLOCKING ADJUSTMENTS sólo para preproducción controlada/UAT.

## Dominios y criterio editorial

- Recibir documento != seleccionar como jurisprudencia != publicar != hacerlo público.
- Fuente de obtención != órgano judicial. Primera instancia debe ser contemplada; sala es opcional.
- Estado editorial, ACL/visibilidad y anonimización son dimensiones distintas.
- Jurisprudencia es selección/curaduría humana; las sugerencias de IA no son fuente de verdad.
- Digesto es organización documental con documentos, colecciones, temas y etiquetas; no es una carpeta universal ni un corpus de fallos.
- Corpus M6 usa `CorpusDocument` como infraestructura, no como sustituto de dominios; fuente administrable, archivo externo a DB, SHA-256, extracción versionada/paginada y ACL por visibilidad. Igual contenido no fusiona identidades jurídicas diferentes.
- `CorpusDocumentLink` registra vínculos externos a selección Jurisprudencia o colección Digesto mediante dominio/tipo/ID/relación; no traslada ownership ni acopla bases con una FK cruzada.
- Storage DEV es local content-addressed; las rutas se resuelven desde base configurable y sólo se persisten storage keys. PDF con texto/TXT tienen extractores; PDF sin capa se marca `OCR_REQUIRED`, sin OCR automático.
- `CorpusSearchSourceAdapter` comparte AST/SearchSourceAdapter y filtra visibilidad antes del total. M7.1 añade `FederatedSearchService` en paralelo y el campo aditivo `federated` al endpoint existente. Dedupe sólo con links explícitos y sobre prefijo limitado; `totalExact=false` cuando hay candidatos fuera de ventana. ACL técnica implementada, política institucional aún pendiente. Sprint 8 smoke real probó la rama Corpus; no equivale a una sesión HTTP conjunta con ambas fuentes.
- Canal de paquete institucional 1.0: manifest JSON/CSV/folder; SHA-256, ID estable, procedencia y visibility declaradas; rutas contenidas y archivos PDF/TXT validados. Dry-run read-only; import sólo en DEV por guard; receipts se guardan fuera del paquete por run. ZIP directo no soportado. Estado package no persistido como batch en DB; metadata original y receipts guardan trazabilidad.
- Endpoints Corpus: metadata y archivo público sólo PUBLIC; rutas autenticadas según rol. 404 oculta existencia; archivo devuelve PDF/TXT con nombre seguro y Range. Aprobación de visibilidad PUBLIC exige gobernanza previa.
- CIJ: prioridad para recuperar histórico Civil. CSJN/Corte: prioridad para fallos actuales. Lex100 sólo por mecanismo institucional autorizado.
- Alcance Civil v1: sólo Cámara Nacional de Apelaciones en lo Civil (Salas) y Juzgados Nacionales en lo Civil de Capital Federal; excluir Civil y Comercial Federal y otros fueros aunque compartan jurisdicción. Mapear catálogos oficiales estructurados; no usar `LIKE '%civil%'`. Alcance operativo completo sigue condicionado a catálogo autorizado.
- Copernic inspira esta necesidad de producto: **Todo documento autorizado almacenado en el repositorio institucional debe poder ser encontrado por su contenido, leído y navegado rápidamente.**

## Estado implementado y gate pendiente

- El adapter PostgreSQL comparte el AST con SQLite, parametriza valores y aplica whitelist interna de campos. Sus siete pruebas PostgreSQL opt-in pasan en DEV.
- Corpus M6/M7.1/S8: tests `corpus-tests` 3/3, `corpus-package-tests` 2/2, PostgreSQL Search 7/7 y tests dirigidos 13/13 pasan. Sprint 8 añadió ingesta real DEV con 10.732 documentos, segunda pasada idempotente y smoke Search/visor; informes 53–60. No implica aprobación editorial ni permiso productivo.
- La importación de fixture es idempotente y excluye tb_microisis; SQLite se abre read-only/immutable/query-only. Los informes 29–32 registran procedencia, paridad y planes.
- `benchmark-busqueda.json` original permanece intacto. Sprint 8 añadió sólo la migración aditiva GIN de título tras plan medido; no editó migraciones aplicadas. El gate sigue siendo DEV y no es certificación productiva.

## Evidencia relacionada

Diseño del buscador: 13–20. Procedencia: 21. Digesto: 22. PostgreSQL inicial: 25–28. Implementación y tuning: 29–35. Corpus M6: 36–40. Discovery M7: 41–46. Paquete y Search/ACL M7.1: 47–52. Corpus institucional Sprint 8: 53–60. Cambiar una decisión requiere evidencia contradictoria y actualizar este documento y el estado.

## Decisiones Sprint 9 — 2026-10-08

1. El corpus único conserva CorpusDocument/archivo original. Digesto Collections/Topics/Tags son relaciones/metadatos; no se copian archivos.
2. El Digesto legacy permanece un dominio aparte. Los 278 PDFs locales siguen excluidos, el endpoint histórico no se consultó y no se importaron datos. No inferir IDs equivalentes ni ACL; no hay cross-domain links.
3. Asociaciones de documentos, clasificaciones y selección editorial son decisiones humanas auditadas. Nada se autoaprueba; selección exige Sentencia existente y motivo; no altera ACL/publicación.
4. Roles actuales ADMIN/OPERADOR se conservan. No se inventa rol revisor ni usuario humano seed. La cuenta técnica OCR queda inactiva.
5. OCR sólo piloto local determinista de 20 archivos; derivado content-addressed, original intacto, expansión requiere evidencia de calidad.
6. Scan incremental no elimina documentos al detectar faltantes; marca estado y conserva historial.
7. Search extiende metadata Digesto Corpus, pero no reemplaza búsqueda/contenido/ACL del Digesto legacy.
8. Sprint 9 cierra NO GO para aceptación completa/producción mientras falten las evidencias enumeradas en informe 70.

## Decisiones Sprint 10 — 2026-10-08

1. Los 276 PDFs únicos locales de Digesto ingresan al Corpus compartido en DEV, `DIGESTO_LOCAL`, INTERNAL y revisión pendiente; no constituyen aceptación ni publicación institucional.
2. Sin export local Digesto no se inventan IDs, temas/tags legacy, relaciones ni ACL. La colección creada es un marcador de metadata pendiente.
3. Se crean seis identidades de prueba sólo para DEV. No son personas reales ni validan ACL institucional. Las credenciales permanecen locales con ACL restringida.
4. PDF.js text layer realiza highlight y navegación; snippet/contexto queda de fallback.
5. Ground truth OCR de 20 páginas registra CER/WER y outliers; no se amplía el procesamiento hasta revisar calidad.
6. ACL técnica y E2E autenticado pasan; piloto sólo guiado local. Aceptación humana y hardening antes de compartir siguen pendientes.
7. Batch auditado se limita a clasificación; membership/envío batch y undo genérico no están disponibles.
8. Resultado Sprint 10: READY FOR PILOT CON AJUSTES, no producción-ready.

## Decisiones Sprint 11 — 2026-10-08

1. Dictamen de Sprint 11: NOT READY FOR PREPRODUCTION por latencia medida (total p50 6,8–13,8 s; Search bajo concurrencia p95 hasta 65,7 s), restore aislado no validado y EXPLAIN ANALYZE representativo cancelado por timeout. Mantener sólo DEV local acompañado.
2. Se limita query de adapter a `BJC_SEARCH_STATEMENT_TIMEOUT_MS` (default 4 s, máximo 4,5 s) para que PostgreSQL cancele consultas largas bajo el timeout federado. El límite reduce trabajo huérfano, no resuelve el rendimiento legacy.
3. Exigir `JWT_SECRET`, validar `JWT_EXPIRES_IN`, y configurar CORS explícito en producción. Readiness requiere DB y storage; request IDs y errores 5xx son sanitizados; rate limiter actual es local en memoria y sólo vale para una instancia.
4. Lotes Digesto membership y envío Jurisprudencia a revisión requieren preview, límite de 50 IDs, resultado por ID y auditoría. La reversión de aprobación/rechazo de clasificación vuelve a SUGGESTED con motivo y nuevo evento; no borra eventos anteriores.
5. OCR PSM 4/300 dpi mejora dos páginas atípicas, pero no cambia el pipeline ni indexa texto nuevo hasta revisión visual humana y muestra autorizada.
6. Dump DEV con SHA queda en recovery privado. Prohibido probar restore sobre DB principal. Restore/migrate-from-zero continúan BLOQUEADOS hasta contar con `pg_restore` permitido y base temporal aislada.
7. HUMAN ACCEPTANCE es PENDING y se informa por separado del dictamen técnico; no se infiere aceptación de cuentas E2E.

## Actualización Sprint 12 — 2026-10-08

- Con filtro de colección, tema o etiqueta Digesto, el origen Jurisprudencia legacy no participa: esos filtros pertenecen a Corpus/Digesto y el fan-out heredado era costoso. Topic/tag usa SQL parametrizado. La paridad posterior no pudo revalidarse: el benchmark de 40 casos expiró bajo `statement_timeout`; 40/40 sigue siendo evidencia histórica Sprint 5.3.
- La página Corpus selecciona IDs limitados antes del enriquecimiento; semántica de COUNT y paginación permanece igual. EXPLAIN observó menor cantidad de loops/hits, pero no mejoró suficientemente la latencia total.
- El log lento sólo incluye requestId, ruta plantilla, status y duración configurable por `BJC_SLOW_SEARCH_MS`; no registrar query/body/extractos.
- No relajar timeout runtime ni cambiar el contrato de total exacto/API sin decisión explícita y evidencia.
- Gate actual NOT READY por Search/concurrencia y restore/migration-from-zero no comprobados. Informes 88–98.

## Actualización Sprint 12.1 — 2026-10-08

1. Search mantiene el contrato de coincidencia y pasa el benchmark de IDs 40/40. Se elimina sólo el COUNT legado de texto que duplicaba el predicado y no daba total exacto útil; filtros no textuales mantienen COUNT.
2. No aceptar los índices de páginas/orden de las pruebas: EXPLAIN no los justifica; migraciones de cleanup dejan el estado final sin ellos. No cambiar a FTS hasta demostrar preservación de subcadenas, acentos, ñ, frases y paridad.
3. El timeout de búsqueda se mantiene dentro del rango configurado (4 s default, máximo 4,5 s). No se eleva para maquillar cancelaciones `57014`.
4. El gate técnico permanece NOT READY: Search común p50 6,26 s y concurrency Search p95 45,57 s a 10 usuarios. Restore y DB vacía quedaron probados PASS. Reportes 99–106.
5. Restauración y migración usan guard temporal independiente limitado a `buscador_juridico_civil_restore_test` y `buscador_juridico_civil_migration_test`; `with-dev-db-guard.cjs` continúa limitado a la DB DEV exacta. No conceder CREATEDB persistente.


## Decisiones Sprint 12.2 — Search V2 (2026-10-08)

1. `CorpusSearchToken` es read model derivado de `CorpusDocument.searchText`, nunca fuente jurídica. Sólo se consulta con readiness verificada; triggers sincronizan altas/cambios y rebuild/verify/repair permanecen bajo guard DEV.
2. El executor combina IDs (`INTERSECT`/`UNION`/`EXCEPT`), conserva ACL/visibilidad temprana y verifica la semántica exacta antes de devolver resultados. Mantener fallback exacto mientras la proyección no esté lista.
3. `totalExact`, `hasMore` y `partial` expresan explícitamente ventanas acotadas y errores de fuente; no presentar cotas como totales exactos.
4. Paridad de Sprint 12.2 PASS (40/40 y semántica 11/11), pero el endpoint/API y concurrencia no cumplen: TECHNICAL PREPRODUCTION NOT READY. El adapter rápido no basta porque la ruta visible sigue esperando el camino legacy.
5. No decidir motor externo todavía: la medición evidencia una brecha de integración y rechecks de texto largo; completar esos dos puntos y repetir evidencia antes de un ADR de reemplazo.

## Decisiones Sprint 13 — preproducción/UAT (2026-10-08)

1. Sprint 12.3 `READY WITH NON-BLOCKING ADJUSTMENTS` habilitó continuar al gate de preproducción controlada/UAT; no autoriza producción ni red compartida.
2. No se identificó destino preprod institucional. El host DEV y la DB `buscador_juridico_civil_dev` no se renombrarán ni usarán como preprod. No se ejecutaron migraciones ni importaciones en Sprint 13.
3. UAT, ACL, anonimización y retención permanecen PENDING hasta decisión/aceptación de owners reales. Las cuentas y pruebas sintéticas no sustituyen personas.
4. Sin export Digesto autorizado, no inferir IDs/taxonomía/crosswalk ni importar metadata. El owner puede resolver por separado si el export es necesario para el piloto.
5. Performance de Sprint 12.3 es baseline local in-process, no SLA ni medición de topología real. Medir 1/5/10 sólo en preprod autorizada y con toleración de IT.
6. No desplegar a producción como consecuencia automática de Sprint 13; CIJ/CSJN masivo automatizado continúa NO GO.
7. El modo preprod fail-closed requiere variables target explícitas y `BJC_PREPROD_DATABASE_APPROVED=true`, compara URL de conexión con host/puerto/base/rol declarados, rechaza loopback, exige storage/origin/JWT/rate limit y restringe a una réplica mientras el rate limit sea en memoria. Toda acción DB del guard valida además identidad/puerto/dirección efectiva al conectar. Esto no sustituye autorización institucional externa.

## Decisión Sprint 15 — espacios privados por dependencia (2026-10-13)

1. Galilei conserva dos scopes en el mismo Corpus y Search: `GENERAL` y `PRIVATE_WORKSPACE`. La búsqueda general excluye los privados por SQL; la privada exige membership activa y `WorkspaceDocument.workspaceId` antes del conteo, página y snippet.
2. El rol global no confiere acceso workspace. ADMIN/EDITOR/VIEWER son roles locales; incluso ADMIN global requiere membership activa explícita para leer, buscar o descargar.
3. Cada dependencia tiene un workspace. Los documentos privados permanecen RESTRICTED y nunca se promueven automáticamente. No se exponen rutas del storage ni enlaces estáticos.
4. Reusar extracción PDF, páginas, Search AST/adapter y storage SHA existente. Hash igual en dos dependencias conserva dos documentos/vínculos lógicos y comparte un blob. Upload limitado a PDF; OCR_REQUIRED queda visible pero fuera de Search.
5. Migración aditiva `20261013130000_sprint15_private_document_workspaces`, sólo DEV loopback, sin reindexar CorpusSearchToken. Backup pre-migración: manifiesto verificado Sprint 14.9. No se habilita producción ni aceptación institucional.
6. Sprint 14.9.2 PHRASE permanece PARTIAL; Sprint 15 no altera ni optimiza esa semántica.

## Decisión Sprint J2 — identidad jurídica y de archivo (2026-10-14)

1. `SHA-256` identifica bytes de un archivo, no una decisión judicial. `LegalDecisionIdentity` debe apoyarse en ID nativo estable cuando exista y, con evidencia corroborada, expediente, órgano, Sala si corresponde y fecha de decisión. El campo de expediente/año se conserva separado del año de decisión; carátula es evidencia descriptiva, no clave de unión.
2. Una misma decisión puede conservar varios `CorpusDocumentFile` con hashes diferentes y su propio `CorpusIngestionRecord`/metadataOriginal. No sobrescribir ni fusionar archivos para normalizar versiones, OCR, correcciones o redacciones.
3. El esquema actual soporta varios archivos dentro de un `CorpusDocument`, pero `CorpusDocument` no es una entidad `LegalDecision` tipada y `CorpusIngestionService.linkExisting` exige SHA ya presente y único. Su límite es funcional y de servicio, no prueba de que dos SHA representen decisiones distintas.
4. Regla de linker v2: SHA igual + metadatos jurídicos consistentes habilita `LINK_FILE_EXACT`; expediente/órgano/Sala/fecha iguales con SHA diferente puede ser identidad jurídica `HIGH`, pero `allowedAction=REVIEW` hasta comparar representación y recibir revisión aprobada. SHA distinto con fecha conflictiva se rechaza; título solo queda `LOW/REVIEW`. Sin escritura automática.
5. No se crea migración en J2. Para escribir una segunda representación bajo una decisión existente se requiere un flujo que preserve cada file ID/hash/provenance y compruebe el comportamiento de extracción, Search y “latest file”; alternativamente proponer entidad LegalDecision/DecisionRepresentation, con coordinación previa de schema porque Copernic desarrolla en paralelo.
6. La búsqueda CSJN de primera instancia es fuente de consulta pública confirmada, no un censo total probado. Sin export oficial/estable y permiso de automatización se mantiene denominator `UNKNOWN` y acquisition piloto en cero.

## Decisión Sprint J4 — identidad legal y workflow de review (2026-10-14)

1. La `LEGAL_KEY` de tooling se deriva de jurisdicción, órgano normalizado, Sala para Cámara o número de juzgado para primera instancia, expediente y fecha de decisión. Es reproducible pero no es PK ni se escribe en DB. Título queda como evidencia auxiliar y SHA identifica sólo bytes.
2. La identidad de representación conserva SHA-256, MIME, tamaño, páginas, fuente, ID de registro y hash de texto normalizado. La normalización preserva palabras y orden; no hace OCR ni reordena párrafos. Se extraen encabezado, fecha, Sala, resolutorio, firmas y marcas impresas con patrones observables.
3. `SAME_TEXT_RENDER` requiere clave legal completa y hash textual conservador igual. `SAME_DECISION_DIFFERENT_VERSION` requiere clave legal completa y evidencia independiente concordante: firma/resolutorio o marca documental junto con marcador/resolutorio; la similitud textual no decide sola. Casos con evidencia parcial quedan `INCONCLUSIVE`/human review.
4. `AUTO_SAFE` es sólo una propuesta respaldada, nunca una escritura ni un aumento de coverage. En J4 no hubo acciones `AUTO_SAFE`; 16 propuestas quedan `MODEL_LIMITATION`, 7 `SOURCE_DATA_REQUIRED` y 428 `HUMAN_REQUIRED`.
5. El workflow exporta decisiones humanas (`groupId, decision, reviewer, reviewedAt, notes`) y sólo las valida. Importar una decisión no la aplica a DB. No existe flag ni ruta de escritura en el tooling J4.
6. El modelo admite varios `CorpusDocumentFile` por documento con SHA único por documento y `CorpusIngestionRecord` con procedencia/fileId. Sin embargo, `linkExisting` exige SHA existente y no ambiguo; viewer y Search sirven la versión de archivo más alta y metadata expone la procedencia de ingesta más reciente. Añadir una representación sin política explícita podría cambiar el archivo visible. No crear migración en J4.
7. La entidad `LegalDecision` queda sin decidir hasta integrar ramas y acordar el contrato. Se comparan alternativas A (entidad legal tipada), B (campos y relación de identidad en Corpus) y C (modelo actual conservador) en el artefacto local de J4.

## Decisión Sprint J5 — evidencia de candidatos y colisiones (2026-10-14)

1. No se recuperó `candidateDocumentId` para los 106 casos tras cruzar SHA, IDs source/portal/legacy, ingestas, metadataOriginal y legal keys completas contra el snapshot Corpus; quedan `NOT_RECOVERED`. Título fuzzy no es una clave de asociación.
2. De los 321 conflictos `ONE_SHA_MULTIPLE_LEGAL_KEYS`, 194 tienen varios expedientes exactos impresos en el PDF y 127 conservan colisión de metadata. Un PDF multi-expediente no demuestra por sí solo decisiones independientes ni autoriza un link; validar expediente, fechas resolutivas y contexto.
3. En los 7 metadata conflicts, un PDF confirma el expediente fuente y el expediente Corpus adicional en el mismo archivo; 6 conservan discrepancias críticas. Preservar ambos valores; no sobrescribirlos.
4. Review tiers J5: 2 `HUMAN_READY`, 106 `HUMAN_NEEDS_CANDIDATE`, 6 `HUMAN_NEEDS_SOURCE_DATA`, 321 `HUMAN_STRUCTURAL`, 16 `MODEL_LIMITATION`. `AUTO_SAFE=0`; los cambios de tier son refinamientos de cola.
5. La inspección usa una transacción PostgreSQL read-only y no escribe contenido Corpus/Search, Prisma ni migraciones. Search verify pasa, pero actualiza `verifiedAt`; el timestamp se restauró al valor previo de J4 y los conteos permanecieron iguales. Este update transitorio incumple el gate de cero escrituras, así que J5 queda `PARTIAL`. No se aplican links.

## Decisión Sprint J6 — identidad primaria y alcance de una representación (2026-10-14)

1. `PRIMARY_CASE` identifica el expediente objeto de la decisión; una cita, antecedente o expediente relacionado se registra como rol distinto y nunca se promueve a identidad primaria por aparecer en el mismo PDF.
2. `MULTI_CASE_SINGLE_DECISION` describe una sentencia única que resuelve expedientes acumulados. `TRUE_MULTI_DECISION_PDF` requiere evidencia separada de más de una decisión oficial (encabezados/fechas resolutivas independientes, identidades de expediente disjuntas y resultados resolutorios separados). Repeticiones de encabezados de página o fórmulas como “reunidas las señoras jueces” no bastan.
3. J6 analizó 194 grupos (148 SHA únicos): 8 `SINGLE_DECISION_PRIMARY_CASE`, 174 `MULTI_CASE_SINGLE_DECISION`, 0 `TRUE_MULTI_DECISION_PDF`, 3 ambiguos y 9 insuficientes. Las identidades primaria confirmadas/probables son propuestas para revisión, no links aplicados.
4. Las 127 colisiones de metadata quedan en propuestas: 107 `UNKNOWN`, 17 filas fuente múltiples, 2 conflictos entre fuente y Corpus y 1 conflicto de año de expediente. No hay arreglo seguro ni corrección aplicada; 20 requieren decisión humana.
5. No se añade entidad `LegalDecision`, relación ni migración con estos resultados. El paquete J6 es local/ignorado y la decisión de schema permanece pendiente de coordinación entre ramas.

## Decisión Sprint J6.1 — workflow de revisión humana (2026-10-14)

1. Las decisiones humanas se capturan fuera de DB y se mantienen separadas de la propuesta de máquina. El ledger registra `groupId`, `decision`, `reviewer`, `reviewedAt`, `notes`, confianza/tiempo opcionales, `reviewInputHash`, Git SHA y referencia al snapshot J6.
2. El paquete reproducible usa review-v3 y evidencia J5 por SHA; muestra 187 filas estructuralmente listas (P0=8, P1=174, P2=5). Seis SHA enlazan a un CorpusDocument del grafo J5; en 181 casos el snapshot de revisión no tiene candidato exacto. Las 127 colisiones de metadata, incluidas 107 sin procedencia, permanecen fuera de la ronda.
3. La UI HTML es local y estática, sin requests externos ni persistencia DB. La persona exporta checkpoint CSV/JSON y puede importarlo para continuar; hash/snapshot diferentes se rechazan. Validar o resumir sólo genera archivos en recovery.
4. J6.1 queda `READY FOR HUMAN UAT`, no CLOSED. No hay decisiones reales, métricas de acuerdo humano ni cambios Prisma/Corpus/Search/Viewer. No aplicar las decisiones sin un dry-run aprobado posterior.

## Contrato analítico J7 — calidad, provenance y duplicados (2026-10-14)

1. Las bandas de calidad y prioridades J7 son clasificación explicable de auditoría, no verdad jurídica ni dato persistido. `REVIEW` indica revisión sugerida; no implica que el documento sea incorrecto.
2. Un SHA igual prueba identidad de bytes, pero no identidad de decisión. Texto normalizado igual con SHA distinto indica representaciones candidatas; no autoriza borrar, fusionar ni enlazar CorpusDocuments.
3. Claves jurídicas incompletas o múltiples permanecen candidatas. Provenance completa describe trazabilidad disponible, no validación independiente de la fuente.
4. J7 produce propuestas P1/P2 sin aplicarlas; cualquier reparación exige un sprint posterior con dry-run y controles explícitos. J6.1 conserva su estado `READY FOR HUMAN UAT`; ningún resultado automático equivale a decisión humana.

## Contrato de propuestas J7.1 — recuperación dry-run (2026-10-14)

1. `AUTO_SAFE_DRY_RUN` significa candidata a operación determinística futura, no aplicación, veracidad productiva ni publicación. Toda propuesta exige precondiciones de valor actual, `updatedAt`, SHA del archivo y hash de `metadataOriginal`, más recálculo de clave y Search cuando corresponda.
2. `HUMAN_CONFIRMATION_REQUIRED`, `SOURCE_DATA_REQUIRED`, `MODEL_LIMITATION`, `NO_CHANGE_REQUIRED` y `UNRESOLVED` son estados de análisis y no autorizan escritura. No se completan campos por expediente aproximado, citas ni inferencias masivas de fuente.
3. Una reparación de metadata que altere evidencia de un pack humano debe invalidarlo o volverlo stale; J7.1 cruzó SHA contra J6.1 y no encontró pack afectado por sus cinco propuestas. El hash J6.1 permanece `2b04cdb75acaa36dec515b7b7d8e8928dc80186d10bb6b293d119317b6f1827d` y no se registraron decisiones.
4. La identificación de texto igual con SHA distinto sólo permite proponer relación de representación tras evidencia legal suficiente; no permite fusionar/borrar documentos. Los source records múltiples se preservan salvo duplicidad de identidad probada. En J7.1 los 341 casos fueron provenance esperada.
5. El número docket sin año puede indicar limitación del parser; normalizar su lectura no inventa un año ni completa una clave legal parcial. No cambiar runtime ni datos como parte de J7.1.

## Contrato J7.1.1 — normalizador de expediente Civil (2026-10-14)

1. `normalizeCivilCaseReference()` es una función pura versionada `civil-case-normalizer-v2`; la cadena cruda se conserva en `evidence.rawPreserved`. Sus estados separan canónico, legacy, multi-expediente, parcial, ambiguo, malformado y no soportado.
2. El número canónico elimina separadores de agrupación observados, pero conserva ceros iniciales. Los años de dos dígitos permanecen de dos dígitos; nunca se infiere siglo. Un expediente legacy sin año puede ser reconocido como número, pero conserva `canonicalYear=null` y la clave legal sigue parcial.
3. La barra sólo separa número/año en una forma completa; listas explícitas conservan cada caso y nunca eligen uno. Año contradictorio, año agrupado sin corroboración o lista incierta quedan ambiguos. El parser no recibe texto del fallo ni citas.
4. J7.1.1 no persiste identidad ni reconstruye Search. Los tres cambios frente al normalizador anterior en filas ya válidas son ceros iniciales preservados y corroborados por referencia de origen; no hubo otros cambios de identidad sin justificar. Evidencia real detallada local/ignorada en `_recovery-work/jurisprudencia-j711/`.


## Contrato J7.1.2 — propuesta conservadora de Sala histórica (2026-10-14)

1. AUTO_SAFE_DRY_RUN exige un campo raw estructurado explícito y consistente. Encabezado, tribunal, firma, título, filename y source reference son señales diagnósticas; no se autoaplican si la validación conocida muestra desacuerdos.
2. Cita de una Sala, expediente relacionado y composición judicial no equivalen a la Sala del fallo analizado. Varias Salas propias plausibles se clasifican AMBIGUOUS; una cita en cuerpo no habilita propuesta automática. OCR/texto ausente queda TEXT_INSUFFICIENT.
3. J7.1.2 clasificó 1.254/1.254 filas históricas: 0 auto-safe, 365 probables, 39 ambiguas, 849 sin evidencia propia y 1 con texto insuficiente. No completó campos, no generó decisiones humanas ni modificó el pack J6.1.
4. La validación en 4.816 documentos con Sala conocida produjo 4.479 aciertos/4.479 predicciones para la regla estructurada. La regla de encabezado tuvo 13 desacuerdos/4.722 y tribunal 11/4.576; se mantienen como revisión humana. Las cuatro propuestas auto-safe anteriores de J7.1 fueron degradadas o no reproducidas.
5. El filtro Search usa CorpusDocument.chamber en vivo. Un eventual cambio individual de ese campo no requiere rebuild ni reindex de la proyección tokenizada; J7.1.2 no aplicó cambios. La validez jurídica del dato sigue requiriendo evidencia de fuente y revisión conforme al flujo vigente.

## Contrato J7.1.3 — revisión humana de Sala histórica

El paquete `j713-review-v1` conserva `machineProposalSala` separado de `humanDecisionSala` (ledger de decisiones). Cada caso liga `reviewId` determinístico, documentId, SHA de archivo, clasificación, evidencia/página, propuesta, impacto sobre clave jurídica y filtro exacto, e `inputHash`. Las citas del cuerpo se rotulan “Referencia a otra Sala / evidencia no primaria”. La UI nunca escribe Corpus ni Search.

Decisiones permitidas: `CONFIRM_PROPOSAL`, `SET_OTHER_SALA` (Sala A–M obligatoria), `NO_SALA_EVIDENCE`, `AMBIGUOUS`, `NOT_APPLICABLE` y `SKIP`; comentario opcional. Checkpoint/export JSON contiene input hash, revisión del pack, revisor, timestamp y decisiones; al importar se validan hashes globales y por caso (documentId, SHA, propuesta), duplicados, estados y Sala. CSV es una salida validable; JSON es fuente autoritativa. `--apply` responde “Apply mode is not implemented.” No se genera SQL ni herramienta de aplicación.

Las prioridades ordenan utilidad/evidencia: P0 evidencia propia corroborada y completitud de clave; P1 encabezado propio en página/zona inicial; P2 otra evidencia propia singular; P3 evidencia auxiliar/cola ambigua. La prioridad no equivale a confianza jurídica.

## Contrato de certificación de corpus Civil — J8

Cada documento del manifiesto J8 tiene estados explícitos para archivo, provenance, páginas, Search, Viewer, normalización, Sala, clave jurídica y representaciones. Los estados del corte suman 6.070: `CERTIFIED` 4.814, `CERTIFIED_WITH_KNOWN_GAP` 874, `HUMAN_REVIEW_PENDING` 365 y `MODEL_LIMITATION` 17; `BROKEN`, `UNRESOLVED` y `UNKNOWN` son cero. Un gap histórico o una revisión humana pendiente no se convierte en fallo técnico ni se promueve silenciosamente a limpio. Ningún estado J8 implica una escritura persistida. Contrato y detalle: `BJC-CERTIFICACION-CORPUS-CIVIL.md`.
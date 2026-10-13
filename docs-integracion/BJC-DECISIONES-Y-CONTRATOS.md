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

# Roadmap operativo — Buscador Jurídico Civil

## Candidata — GALILEI SUPER SPRINT 3: estructura + citas pinpoint + parser argentino V2 (2026-10-26)

| Gate | Estado | Evidencia / siguiente paso |
|---|---|---|
| Estructura del fallo | **IMPLEMENTADA / EVALUADA** | Parser determinista v1, extracción del PDF exacto ligado al visor y navegación por secciones. En 200 sentencias/3.350 páginas: 35 outlines, 78 secciones; revisión contextual 78/78 correcta. Cobertura/recall global no medidos; no se fuerza estructura en documentos sin señal suficiente. |
| Pinpoints | **IMPLEMENTADOS / REAL E2E PASS** | Cita y enlace a página PDF 1-based; página admitida sólo si figura en extracción ligada por checksum/ruta al mismo PDF. p. 2 PASS; p. 4 en PDF de 3 páginas devuelve 400. La coincidencia exacta activa se copia con la cita canónica; el término y pasaje permanecen locales. UX sintética responsiva: 9/9. |
| Parser V2 / workflow | **IMPLEMENTADOS / EVALUACIÓN LIMITADA** | Nueve familias; raw citation, parsed fields, página, offset UTF-16, contexto, parser version y checksum persistidos. Resolución exacta publicada/activa; ambigüedad y self-reference no se confunden con verificación. 6.074 detecciones; 50/50 inspeccionadas ciertas, muestra estratificada no ponderada; recall global no medido. Revisión humana necesaria para `VERIFIED`. |
| Migraciones / QA real | **PASS AISLADO / LIMPIO** | PostgreSQL/OpenSearch/NestJS/Vite reales aislados; migration fresh y 34→35; E2E de navegación, ACL, page-link/citation, review workflow y responsive PASS. Tras guardar evidencia se detuvieron y retiraron runtime, datos PostgreSQL/OpenSearch QA, storage y credencial sintética. `prisma migrate status` de principal fue read-only: 4 migraciones pendientes; no se aplicaron. |
| Calidad / Search | **PASS CON P3** | Backend 578 PASS/10 opt-in omitidos; cliente 15/15; investigación Suite 2 Playwright 17/17; typecheck/lint/build PASS. Search: 4.759 / 3.369 / 1.826; orden completo repetible sin diferencias entre dos lecturas. Auditorías producción y completas: HIGH=0 / CRITICAL=0. P3: advertencia de chunk PDF.js >500 KB. |
| Estado Git / CI | **FEATURE CANDIDATE** | `feature/structured-judgment-citations-suite-3` parte de Suite 2 exacta. `origin/dev` y `origin/main` sin cambios. Política: publicar sólo a esta rama y verificar CI por SHA publicado. No promoción. |

Dirección siguiente recomendada tras cerrar el Sprint 3: **mejorar la cobertura de estructura mediante un conjunto editorial de gold labels por Sala/año/formato**, medir precisión y recall ponderados y corregir reglas conservadoras antes de ampliar automatización. No iniciar backfill de todo el corpus ni IA.

## Candidata — GALILEI-RESEARCH-REPRO-SUITE-2 (2026-10-26)

| Gate | Estado | Evidencia / siguiente paso |
|---|---|---|
| Dossier de investigación | **IMPLEMENTADO / PRUEBAS PASS** | `POST /research/collections/:id/export`; owner-only, vuelve a validar fallos públicos/activos, notas privadas; ZIP v1, SHA-256 y límite 1.000. ZIP de 100 fallos: 305 entradas, 132.279 bytes, 92 ms medidos; CRC/hash verificados. Ver `docs/research-bundles.md`. |
| Novedades guardadas | **IMPLEMENTADO / PRUEBAS PASS** | Baseline al crear/primer uso; nuevo = `publishedAt`; reusa `BusquedaService.federatedSearch` con filtros, incluida faceta de Sala multivalor; watermark explícito. Ver `docs/saved-search-novelties.md`. |
| Mismo expediente | **IMPLEMENTADO / PRUEBAS PASS** | Prefijo y año completos, normaliza case/espacios y slash/guion; excluye self y registros no públicos/inactivos; máximo 20. |
| Cliente / CI | **VALIDACIÓN LOCAL PASS** | Typecheck/lint/tests/build, 17/17 Playwright UI mockeadas, producción y full audit sin advisories altos/críticos. CI valida cliente, servidor y audit high/critical; primer run remoto pendiente. |
| Migraciones / servicios | **DISPOSABLE + READ-ONLY PASS** | 34/34 frescas y 33→34 incremental, pending=0, tres columnas; clusters desechables eliminados. Principal PostgreSQL READ ONLY y Search read-only: identidad/outbox correctos, OpenSearch GREEN, V3/V4 69.313 y referencias 4.759/3.369/1.826. Sin escrituras. Publicar sólo la rama feature; no promover a `dev` ni `main`. |
| Hallazgos de cierre | **PASS_WITH_FINDINGS** | El E2E Suite 2 no recorrió API/DB/Search reales; ACL de features cubierta por tests unitarios/servicio. Build avisa sobre chunks PDF.js >500 KB; host usa pnpm 11.25.0 frente al pin 12.15.0 de CI, aunque frozen install pasó. |

El contexto de la candidata anterior queda bajo su encabezado fechado; usar esta sección para el sprint actual.

## Candidata post-UAT — `feature/post-uat-research-suite-1` (2026-10-25)

| Gate | Estado actual | Evidencia / siguiente paso |
|---|---|---|
| Sprints 1–2: continuidad y búsqueda en PDF | **IMPLEMENTADOS / VALIDACIÓN AUTOMÁTICA PASS** | Retorno a la búsqueda, favoritos/cita guardada, búsqueda local PDF.js con conteo, navegación y manejo de PDF sin texto; detalles en `docs/features/research-continuity.md` e `in-document-search.md`. |
| Sprint 3: colecciones y notas | **IMPLEMENTADO / ACL VERIFICADA EN TESTS** | Colecciones privadas por usuario, notas de texto plano, referencias a fallos publicados, sin copiar PDFs; unit tests y E2E mock-only PASS. |
| Sprint 4: facetas y jurisprudencia reciente | **IMPLEMENTADO / FUNCIONAL PASS** | Facetas Sala/año en la consulta pública y URL; fecha de incorporación separada de fecha de decisión. Requiere benchmark de latencia/conteos sobre servicios principales en una certificación read-only aparte. |
| Sprint 5: relaciones/citas | **BASE EDITORIAL IMPLEMENTADA** | Detección explícita acotada, candidatas no verificadas por defecto, revisión manual y publicación sólo entre fallos activos/públicos. Precision/recall 1.00 sólo en 8 ejemplos sintéticos; falta evaluación judicial etiquetada. |
| Calidad local | **PASS_WITH_FINDINGS** | Typecheck, lint, 421 tests backend, 14 tests cliente, 11/11 Playwright y build PASS; 10 tests backend siguen opt-in/skipped. Build advierte sobre chunks de PDF.js >500 KB. |
| PostgreSQL/Search principal | **READ-ONLY PASS** | PostgreSQL 16.15 `127.0.0.1:55432`, outbox 0/0; OpenSearch 2.19.6 GREEN, alias V4, 69.313 docs. Migraciones de feature probadas sólo en QA desechable 55434. |
| DEV / main / UAT | **SIN PROMOCIÓN** | DEV continúa en SHA congelado `e06139e3075ef20a90d586973a7d301515ee5a67`; `main` sigue `83947656420a9d6f6c3cfb12b353eb7f2c293a28`. Próximo paso: publicar únicamente la rama feature y solicitar revisión/UAT de producto; cualquier promoción queda separada. |

## Estado y gates vigentes — principal DEV (2026-10-24)

| Gate | Estado actual | Evidencia / siguiente paso |
|---|---|---|
| DEV y cambios funcionales | **MODERNIZACIÓN PROMOVIDA / PASS_WITH_FINDINGS** | La candidata de código `82aac83c437700ea6dd8bd7310743b6659429789` avanzó desde `749ad15fb429beb652863a51dcb6eb5dd906f841` por fast-forward normal. `origin/main` sigue `83947656420a9d6f6c3cfb12b353eb7f2c293a28`. P0/P1=0 en la revisión previa; quedan documentados P2/P3 y UAT humana pendiente. |
| Checkout principal | **NORMALIZADO / CLEAN** | `client/`, `server/`, `docs/`; checkout histórico de cinco cambios reconciliado y retirado. RAR redundante y runtimes QA terminados eliminados. |
| Search V4 | **ACTIVO / SALUDABLE** | OpenSearch 2.19.6 GREEN; alias `galilei-search-active` y writer sólo en V4. V3/V4 = 69.313; V1/V2 retirados por nombre exacto, 9,49 GiB recuperados. |
| Contrato público | **PASS** | Responsabilidad civil 4.759; frase exacta 3.369; falta de servicio 1.826. Golden 7.694 ASC y DESC, 0 diferencias; sort PASS, 0 timeouts. |
| Auth / espacios / Viewer | **PASS_WITH_FINDINGS EN QA AISLADA** | Auth/RBAC; ACL 12/12; Viewer/Range/Download/Missing Blob; lifecycle 10 pasos/14 eventos con outbox drenado; API negativa 25/25; concurrencia 48 solicitudes, 0 timeout/5xx; E2E 15/15 y responsive 24/24. Se registraron cuatro 404 de recurso no fatales en denegaciones ACL esperadas; errores de página y 5xx inesperados: 0. QA pesada eliminada. Informe: `_recovery-work/galilei-principal-final-functional-cert1/reports/`. |
| Cliente | **VITE VALIDADO / PROMOVIDO A DEV** | React/Vite conserva 40/40 rutas. Typecheck, lint, build, 9 pruebas Node, UX público 22/22, responsive 18/18 y Workspace UAT autenticado 2/2 pasan. El PDF se renderiza en canvas con worker local PDF.js 6.3.289; full/range/download/denegación/ausente pasan. Sprint 15.6.1 ACL enfocado pasó 1/1 en QA. |
| Stack modernization 1R | **PROMOVIDO A DEV / PASS_WITH_FINDINGS** | `refactor/galilei-stack-modernization1` partió de `749ad15`; la promoción del código `82aac83` fue fast-forward y no usó force. El P1 PREPROD está corregido y tiene regresión 1/1; worktree limpio: install congelada, typecheck/lint/test/build PASS, Golden aislado 325/325. La revisión independiente previa encontró P0=0/P1=0/P2=3/P3=1. El UAT autenticado del visor y ACL se ejecutó sólo en QA y no se presenta como aceptación humana. Los P2/P3 y límites están documentados en `docs/migracion-stack-2026.md`. |
| PostgreSQL / Corpus | **PASS READ-ONLY** | PostgreSQL 16.15 en `127.0.0.1:55432`, DB `buscador_juridico_civil_dev`, rol `bjc_dev`; 31 migraciones, outbox 223.815 procesados, 0 pending/0 failed. No hubo escrituras PostgreSQL ni cambios de corpus en esta misión. |
| UAT / oficina / producción | **PENDIENTE SEPARADO** | Esta certificación local no implica UAT humana ni aprobación productiva. Sytec10 no fue accedida; preparar ese equipo sólo en una misión específica. |

## Cronología histórica — decisiones/cortes anteriores

Todo el contenido posterior registra estado y evidencias de la fecha del encabezado. Las afirmaciones antiguas de V3 activo, V4 shadow, promoción pendiente o gates bloqueados no describen el estado actual; usar exclusivamente la tabla de arriba para operar.
## COPERNIC-RESTRICTED-ACL-FIX-2 — candidata para revisión (2026-10-19)

Corregir y verificar el progreso de `search_after` del Search privado sobre la base exacta de Fix-1. La implementación agrega orden total con `id asc`, comparación monotónica de tuples, fingerprints tipados de cursor, detección acotada de ciclos y lotes duplicados, guardas de respuesta incompleta y cierre PIT ante error. REVIEW-1 P2-1 queda resuelto; no hay P0/P1 nuevos. La validación de ACL viva, paginación, carpetas y Viewer HTTP se ejecutó con fixtures DEV sintéticos y limpieza verificada. OpenSearch 2.19.6 se observó read-only; la prueba de 69k escala sigue siendo simulada y la latencia real combinada es P2 pendiente.

Próximo gate: `COPERNIC-RESTRICTED-ACL-REVIEW-2`. Mantener Fix-2 como rama candidata; no promover a DEV ni tocar `main`, integración o ramas UX. La evidencia reproducible queda en `_recovery-work/copernic-restricted-acl-fix2/` (local e ignorada).

## PREPROD-FIX-2 — candidata de hardening (2026-10-18)

`feature/preprod-uat-fix2` parte exactamente de `eb3397774b3d16ddafeac0ffba78ed54a8b7c8e7`. Se cerraron los tres hallazgos de PREPROD-FIX-REVIEW-1: configuración efectiva DEV no redirigible por query, referencias de storage no-DEV obligatorias y adaptadores `pg`/Prisma/libpq derivados de una identidad DB validada una sola vez. La reserva de backup se prueba fuera de los tres roots y el candidato de rollback exige namespace + schema actual. Backend typecheck/build y suite segura PASS (300 tests; 9 suites PostgreSQL omitidas), frontend typecheck/build y URL tests PASS; OpenSearch DEV read-only smoke PASS. El detalle de controles y límites queda en el corte PREPROD-FIX-2 de BJC-ESTADO-ACTUAL y doc 136.

Próximo gate: revisión independiente PREPROD-FIX-2. No promover a DEV. PREPROD/UAT, TLS de infraestructura, `pg_dump`, restore, Docker y ACL efectiva del passfile no están probados.

## PREPROD-FIX-1 — candidata de hardening (2026-10-18)

La rama `feature/preprod-uat-fix` conserva la base exacta `4d68c49d80642a19e93cc1af799fa78414421309`. El código cierra P0/P1 de parser/driver PostgreSQL, preflight obligatorio antes de Nest, alias OpenSearch ajeno/múltiple, TLS efectivo de `pg_dump` y namespace de production; también cubre los P2 seguros de IPv6, storage, efectos de startup, conteo de integraciones y topología. Se mantiene fuera de DEV y no modifica Search semantics, ACL, Viewer, schema Prisma o migraciones.

Calidad local: backend/frontend build y typecheck PASS; suite segura 42/272 con 7 omitidos; focused guard/namespace 65/65; backup 2/2; frontend URL 5/5; ESLint de todos los archivos modificados sin errores ni warnings. Smokes DEV sólo GET: OpenSearch 2.19.6 green, alias activo v3 y 69.313 documentos; no hubo conexión DB ni escrituras. `feature/preprod-uat-fix` se publicó sólo en su ref autorizada. Siguiente gate: PREPROD-FIX-REVIEW-1 independiente; no promover antes de esa revisión. PREPROD no provisionado; backup/restore real, Docker image y UAT no probados.

## corte histórico — preparación de preproducción/UAT (2026-10-18)

| Alcance | Estado | Evidencia / siguiente paso |
|---|---|---|
| DEV + UX | PROMOTED + REVIEWED | `origin/dev=af8f51d6f5e5be48e0167c5890328acd3c80c2c4`; UX ya está en DEV. `main` intacta. |
| INT-1R | PASS | SHA certificado `111bc5c86faff0bf946ef5e199b4463fe8217d5a` permanece en `integration/galilei-beta`; no se mueve en esta misión. |
| PREPROD-UAT-PREP-1 / PREPROD-FIX-1 | CANDIDATE PUBLISHED; INFRA BLOCKED | Rama de preparación preservada en `feature/preprod-uat-prep`. `feature/preprod-uat-fix` parte exactamente de `4d68c49d80642a19e93cc1af799fa78414421309`; quality local PASS; publicada sólo en su ref; revisión independiente pendiente; sin promoción. |
| Host / DB / storage preprod | NOT PROVISIONED | No se identificó destino institucional autorizado. Solicitar host, PostgreSQL 16, volumen, OpenSearch, TLS, DNS/proxy, firewall y owners (doc 140). |
| Fresh migration replay | CERTIFIED BY EXISTING SHA EVIDENCE | 31/31; hashes coinciden con la prueba aislada INT-1R. No repetir sobre DEV ni crear DB sin destino temporal autorizado. |
| Backup / restore preprod | CODE FIX IN CANDIDATE; REAL DUMP/RESTORE NOT PROVEN | El plan fuerza `verify-full`, CA, identidad canónica y passfile; falta correr `pg_dump`/restore real en infraestructura aprobada. |
| UAT institucional | PLAN ONLY / NOT STARTED | Sin host, perfiles reales, corpus aprobado ni cuentas. No invitar usuarios ni emitir credenciales. |
| Capacidad local | BELOW RESERVE | C: 40,84 GiB libres vs ≥50 GiB recomendado; v3 actual 13,19 GiB, además de DB/storage/backups. No dimensiona el host UAT. |

Siguiente gate: PREPROD-FIX-REVIEW-1 independiente. La topología elegida es API loopback + proxy del mismo host; proxy en contenedor separado NO CERTIFIED. El startup puede recuperar scans/OCR y procesar outbox, por lo que DB/Search/storage/backup deben estar healthy antes de iniciar. Luego infraestructura provisiona y entrega identidad/owner/ventana. Sólo entonces ejecutar el runbook 136 con guard de DB, restore drill y service manager aprobado. No desplegar producción ni iniciar UAT real.

## corte histórico — Search DEV y reconciliación UX separada (2026-10-18)

| Alcance | Estado | Evidencia / siguiente paso |
|---|---|---|
| Contrato COPERNIC_PREFIX_EXACT_PHRASE | CLOSED | TERM prefijo léxico; frase exacta contigua; comodines explícitos preservados. |
| Evaluación OpenSearch | PASSED | OpenSearch 2.19.6 como índice derivado; PostgreSQL continúa source of truth. |
| Cobertura y consistencia | COMPLETE | Schema v3: 69.313/69.313; 0 missing/extra/duplicates; hash exacto postpromoción. |
| Integración de rutas y seguridad | CLOSED en branch | HTTP golden/phrase/prefix/filter/sort/names/ACL/publicación/Viewer/sync/fail-closed certificados. |
| Alias de integración | V3 ACTIVE | `galilei-search-active` → `galilei-search-v003-20261017t232432555z-a6af18cb`; v1 retenido para rollback. |
| INT-1S | CLOSED | Semántica, exactitud y rendimiento Search certificados. |
| INT-1R + promoción separada | PASS / VERIFIED | `origin/dev == origin/integration/galilei-beta == 111bc5c86faff0bf946ef5e199b4463fe8217d5a`; igualdad verificada read-only. |
| UX-RECONCILE-1 | PASS — branch only | `feature/ux-reconcile` parte del SHA certificado; harness 65/65 escenarios, E2E autenticada PASS, 27 capturas responsive de rutas + 3 del diálogo ACL; sin promoción UX→DEV. Esperar revisión del branch. |
| UAT institucional / preproducción | PENDING | No se completan con INT-1R ni con UX-RECONCILE; producción no está habilitada. |
| Reserva de almacenamiento de producción | PENDING | Recomendada ≥50 GiB libres; el volumen local al cierre tenía 41,98 GiB. |

Calidad INT-1R: backend 37 suites/224 tests pass, con 8 suites/20 tests optativos omitidos; typecheck/build backend y frontend, lint dirigido, secret scan y diff-check PASS. Prisma 31/31 up-to-date; replay limpio de las 31 migraciones reutilizado por SHA desde el clúster PostgreSQL 16 aislado certificado en Sprint 1.5.1. El scan final del alias v3 confirma 69.313 IDs exactos, outbox 0/0. El benchmark HTTP actual (2 warmups + 20 muestras) registró p95 de 173,86/240,03 ms y cero timeouts.

Nota de alcance de tests: el test optativo PostgreSQL-only Sprint 15.5 falló al ser forzado en `C-PHRASE-LINE` por timeout del adapter legacy; no ejercita la ruta activa OpenSearch. La Golden HTTP v3 continúa 325/325; las fixtures de ese intento se limpiaron, los eventos de outbox se drenaron y la integridad del alias v3 quedó verificada nuevamente.

Próxima acción: revisar `feature/ux-reconcile` en su branch. No promover ese branch a DEV en esta misión. UAT y preproducción siguen pendientes; `main` y las ramas UX de entrada quedan fuera del alcance.
## Sprint INT-1S.6 — decisión de resultados rápidos (2026-10-15)

**NO GO para `FAST RESULTS + ASYNC EXACT TOTAL`.** Con el total exacto excluido del camino diagnóstico, la primera página de “responsabilidad civil” mantuvo p95 4.210 ms y 10/10 timeouts SQL de Corpus; “falta de servicio” tuvo p95 4.255 ms y 10/10. No continuar con jobs/caches de total ni índices estructurales. INT-1S e INT-1R siguen BLOCKED; no promover `dev` ni iniciar UX-2.

**Siguiente decisión:** encargar por separado evaluación de motor Search externo o cambio explícito del contrato de producto. No seleccionar ni instalar un motor en esta continuidad. Evidencia: `_recovery-work/integration-int1s6/decision.json`.

## estado registrado al cierre de ese corte — Sprint INT-1 (2026-10-14)

**INT-1 PARTIAL; integración local lista para revisión/publicación de branch.** Ambas ramas están fusionadas en integration/galilei-beta; la shell Galilei distingue Jurisprudencia, Mi Sala / Juzgado y Mis documentos. Replay limpio de 28 migraciones, Search golden + verify, Viewer, ACL/workspace E2E, typechecks y builds pasan. No actualizar origin/dev: DEV local reporta 0 fallos publicados (frente al snapshot J9 esperado de 6.014) y faltan los manifests J7/J8 que autorizan repetir certificación de Corpus/publicación. No transformar ni publicar datos para hacer coincidir conteos.

| Gate vigente | Estado | Evidencia / siguiente paso |
|---|---|---|
| Integración source/schema | PASS | Ambos tips son ancestros de integration/galilei-beta; 28 migraciones preservadas; sin migration de reconciliación. |
| Replay/migrate/Search/Viewer | PASS con objetos SQL administrados | Replay 28/28; diff raw muestra proyecciones e índices históricos fuera del datamodel, sin pérdida; no quitar esos objetos. |
| J8/J9 snapshot de datos | BLOCKED | DEV local: 0 published, 21.083 activas no publicadas; faltan manifests J7/J8. Obtener bundle correcto y certificar en sólo lectura. |
| E2E/ACL/workspace | PASS | Reader/operator, workspace y multi-dependencia, ACL personal/restringida pasan; cleanup DB=0. Quedan cuatro archivos sintéticos no referenciados en un storage aislado porque la revisión automática rechazó su borrado. |
| UAT/preproducción | PENDING | Continuar tras resolver snapshot, performance y cleanup, y obtener aceptación humana. |

PHRASE "responsabilidad civil" dio 956,57/1.304,95/1.304,95 ms (p50/p95/máx); Jurisprudencia 183/188/188 ms, Corpus 956/1.304/1.304 ms. Bajar el p95 total sin relajar exactitud ni ACL antes de UAT.

## INT-1S.4 — cierre de acelerador por chunks (2026-10-15)

**ADAPTIVE CHUNKS REJECTED; INT-1S sigue BLOCKED.** La prueba progresiva 2048/127 y 1024/127 redujo la latencia de `falta de servicio` (p95 1.130 ms y 519 ms; conteo exacto 202), pero ambas configuraciones agotaron el límite de 4 s para `responsabilidad civil`. La de 2048 ocupó 597,76 MiB y requirió 397 s de población + 460 s de índice; 1024 ocupó 833,44 MiB y requirió 912 s + 555 s. 512 no se probó: 1024 no mejoró el caso bloqueante y la proyección 512 superaba 1,04 M de chunks. Los prototipos UNLOGGED se eliminaron; no hubo migration, backfill ni cambios de Search de producto. Evidencia: `_recovery-work/integration-int1s4/final-summary.json`.

**Siguiente decisión recomendada:** evaluar como misión separada INT-1S.5 (índice dedicado de postings de substring/posiciones de caracteres), sin iniciarla automáticamente. No promover `dev`, iniciar UX-2 ni modificar `main`; INT-1R también permanece BLOCKED.

## Gate de portabilidad source — 2026-10-13

**PASS en `dev`, commit `373e7c0add34580baade5fe873849c97f2fda061`.** El clone limpio instalado sólo desde los lockfiles validó Prisma, typecheck/build de backend y frontend y 90 tests backend sin runtime; 19 tests/suites optativos se omitieron por depender de PostgreSQL DEV o de la SQLite histórica. La regla global `**/logs/` fue reemplazada por exclusiones runtime específicas; se recuperaron seis fuentes ignoradas y el fixture SQLite real permanece fuera de Git. El lint frontend conserva cuatro errores previos de hooks y una advertencia; typecheck y builds están limpios.

Siguiente gate: publicar este commit en `origin/dev`, actualizar la PC de oficina con `git pull --ff-only origin dev` e instalar dependencias con los lockfiles. La transferencia de DB/Corpus/PDFs continúa separada y requiere su flujo de runtime autorizado; este resultado sólo certifica source portable.

## Sprint 14 — recuperación pública de jurisprudencia (2026-10-08)

| Fase | Estado | Evidencia / próximo insumo |
|---|---|---|
| Discovery | PASS WITH GAPS | 421 enlaces CSJN a tomos (349 números); sitemap CIJ no utilizable (host interno); Datos Abiertos sin coincidencias; TFN/CIJ sentencias disallow. Docs 146–154. |
| Adquisición | BLOCKED | 0 archivos completos. El ejecutor rechazó guardar PDF de muestra antes de ejecución. Se requiere vía local permitida; CIJ/TFN requieren canal institucional. |
| Clasificación / dedupe / ingesta | PARTIAL / BLOCKED | Helpers offline y 7 tests; sin PDF individual para reconciliar ni ingresar. Docs 152–156. |
| Sync | BLOCKED | No hay cursor de fuente verificable; no automatizar rutas con CAPTCHA o robots-disallow. Doc 157. |

**Siguiente acción basada en gaps:** habilitar una vía aprobada para adquirir los PDFs CSJN publicados y solicitar export/paquete institucional CIJ/TFN; después reconciliar el lote y ejecutar dry-run e ingesta DEV bajo guard. No volver a preproducción ni reauditar Search.

**Actualizado:** 2026-10-13 tras cierre técnico Sprint 14.9.2. No repetir auditorías cerradas salvo evidencia contradictoria.

**Estado al cierre de Sprint 14.9.2 (histórico):** PHRASE estaba sobre el gate: p95 comparable 2.427,38 ms y early exit no certificaba totalExact. El plan de esa fecha posponía revisión de los 452 grupos y 4.890 enlaces abiertos hasta cumplir latencia y exactitud. La auditoría de fuentes del 2026-10-13 añadió un siguiente sprint de discovery P0 que no requiere ingesta ni cambios de Search; ver la prioridad vigente al final.

## Gate vigente — Sprint 14.9.2 (2026-10-13)

**Estado al cierre de Sprint 14.9.2: PARTIAL / PHRASE REGRESSION REMAINS.** No se conservó una modificación del runtime. Se comprobó el coste del orden/agregado completo antes de la primera ventana y el coste prohibitivo de contar todos los textos vía ILIKE. El total exacto permanecía pendiente cuando PHRASE salía temprano. La restricción afectaba a esa fase técnica; la adquisición/ingesta sigue requiriendo sus propios gates. Evidencia: _recovery-work/sprint1492/final-summary.json.

| Fase | Estado | Salida / evidencia |
|---|---|---|
| 1. Auditoría y recuperación legacy | DONE | Informes 01–12. |
| 2. Contrato y arquitectura de búsqueda | DONE (diseño) | Informes 13–16. |
| 3. Search Spike SQLite | DONE | Informes 17–18; baseline original preservada. |
| 4. Recuperación entorno | DONE | pnpm reproducible, Prisma generate, suite completa y build. |
| 5. PostgreSQL Search | DONE / GO PARA INTEGRACIÓN DEV | PG16.15 loopback; DB DEV; seis migraciones; fixture 21.109/25.138; adapter; 40/40; reducción mediana p50 56.3%; informes 29–35. Producción espera SLO/carga/corpus real. |
| 6. Corpus Documental Civil | DONE / DEV | Infraestructura documental, extracción PDF/TXT, ACL y Search adapter; informes 36–40. |
| 7A. Fuente pública CSJN / CIJ Civil | CERRADA EN NO GO | Discovery 41–46; `robots.txt` restringe las rutas PDF observadas. Sin crawler, adapter remoto ni piloto. Reabrir sólo ante mecanismo autorizado que resuelva la restricción. |
| 7B. Paquete institucional + Search/ACL | IMPLEMENTADA EN DEV | Canal JSON/CSV/carpeta, fan-out y endpoints; pruebas sintéticas M7.1. Informes 47–52. |
| 8. Ingesta institucional local | DONE — GO CON AJUSTES DEV | 23.829 PDFs físicos/10.732 SHA; dos pasadas idempotentes; extracción, clasificación RULE, Search smoke, panel y viewer; 58 tests generales, suites opt-in y builds PASS. Informes 53–60. No certifica producción. |
| 9. Unificación y curaduría Jurisprudencia + Digesto | IMPLEMENTADA EN DEV; NO GO integral | Taxonomía Corpus, workflow auditable y cola de revisión. Dominio Digesto legacy y crosswalk ACL siguen pendientes; ver informes 61–70. |
| 10. OCR local acotado | PILOTO 20/20; calidad pendiente | 94 páginas procesadas; quedan 379 OCR_REQUIRED y un inválido. Exactitud sin ground truth. Informe 66. |
| 11. Viewer/document navigation | PARCIAL | Página, contexto y anterior/siguiente; falta realce PDF y aceptación autenticada. Informe 68. |
| 12. Incremental inventory / sourceMissing | IMPLEMENTADO; prueba de delta pendiente | Corrida encontró 23.829 unchanged y cero cambios/faltantes; validar otros deltas con fixtures. Informe 67. |
| 13. Validación de usuarios y producción | PENDIENTE / NO GO | Usuario de aceptación, matriz ACL, política de anonimización/retención y SLO/carga. Informe 70. |

## Siguiente acción concreta

Siguiente acción de producto queda en espera del gate Search: PHRASE p95 <=1.200 ms y total exacto comprobado para early exit. Al cumplir ambos, retomar primero los 452 grupos de revisión y luego los 4.890 enlaces abiertos. CIJ/CSJN permanece en NO GO hasta canal autorizado.

## Actualización de roadmap tras Sprint 9 — 2026-10-08

| Fase | Estado | Salida / evidencia |
|---|---|---|
| 9. Unificación y curaduría en DEV | IMPLEMENTADA, NO GO integral | UI y rutas de curaduría; prueba PostgreSQL sintética; 21.547 clasificaciones y 29 asociaciones siguen sin revisión humana real. Informes 61–70. |
| Digesto institucional real | BLOQUEADO POR INSUMO AUTORIZADO | Catálogo, permisos, export/crosswalk y prueba de búsqueda/ACL pendientes. No consultar endpoint ni importar 278 PDFs excluidos. |
| OCR español local | PILOTO 20/20; calidad pendiente | 94 páginas, originales intactos; hace falta ground truth antes de ampliar. Quedan 379 OCR_REQUIRED y un inválido. |
| Scan incremental | IMPLEMENTADO; delta no ejercitado | La corrida real halló 23.829 sin cambio. Validar NEW/MODIFIED/MISSING con fixtures de prueba. |
| E2E de usuario/ACL | PENDIENTE | Requiere usuario autorizado y matriz de permisos de aceptación; no sembrar credenciales. |
| Viewer resaltado PDF | PENDIENTE | Hoy contexto/snippet/página y navegación anterior/siguiente. |
| Producción | NO GO | Pendientes de Sprint 9 más anonimización/publicación/retención/SLO/carga y aprobación institucional. |

Siguiente paso: conseguir export Digesto y usuario/matriz de aceptación institucionales por canal autorizado; con esos insumos ejecutar validación de ACL, revisión humana, ground truth y E2E antes de decidir un nuevo GO. Mantener toda operación local bajo el guard DEV.

## Actualización Sprint 11 — 2026-10-08

| Gate | Estado | Próxima acción |
|---|---|---|
| UAT / aceptación | PENDING HUMAN ACCEPTANCE; checklist docs 79 | Agendar sesión por perfil, registrar incidencias sin convertir E2E en aprobación. |
| Search y concurrencia | NO GO: p95 Search 7,1/37,1/65,7 s a 5/10/20 usuarios | Reducir coste legacy y federado; repetir E2E/perfil tras corrección. No exponer en red compartida. |
| Backup/recovery | Dump con hash PASS; restore bloqueado | Habilitar ejecución autorizada de `pg_restore` y DB temporal con privilegios limitados; probar restore y migrate desde cero. |
| Seguridad | Hardening local implementado; multiinstancia/TLS/monitoreo pendientes | Configurar entorno real, proxy/IP, TLS, secretos y retención antes de candidate gate. |
| OCR | Mejora puntual PSM4 probada en dos outliers, revisión humana pendiente | No actualizar extracción ni expandir OCR hasta validar imágenes y política en muestra autorizada. |
| Digesto metadata | Export/crosswalk no encontrado | Solicitar paquete institucional autorizado; no acceder a endpoint remoto. |
| Viewer | Ranges y páginas 1/50/109 PASS; límite muestreado 11,35 MiB | Considerar streaming si el corpus futuro incorpora objetos significativamente mayores. |
| Curaduría | Lotes y reversión de clasificación E2E PASS | Validar flujos con equipo responsable y completar ACL institucional. |

## Siguiente acción concreta al cierre de Sprint 14.9.2 (histórica)

Mantener **NOT READY FOR PREPRODUCTION**. Priorizar performance legacy/federada y dashboard; luego restauración/migraciones reproducibles en ambiente aislado. La siguiente sesión humana es UAT guiada y aceptación de matriz ACL; la aceptación no cambia los bloqueos técnicos por sí sola. Informe integral: `87-RESULTADO-SPRINT-11.md`.

## Cierre Sprint 10 — actualización 2026-10-08

| Fase | Estado | Evidencia |
|---|---|---|
| Sprint 10 — Pilot Readiness | DONE — READY FOR PILOT CON AJUSTES | 71–78; Digesto local, roles DEV, E2E, PDF.js, OCR ground truth, scan incremental 23.829 unchanged y builds. Piloto guiado en DEV. |
| Metadata/crosswalk Digesto | PENDIENTE DE EXPORT LOCAL AUTORIZADO | No se halló export ni IDs/taxonomía; no consultar servicio remoto. |
| Aceptación institucional / ACL | PENDIENTE | E2E técnica pasa; falta revisión de personas, permisos institucionales y flujo browser de administración de cuentas. |
| OCR ampliado | PAUSADO POR CALIDAD | CER 19,43%, WER 28,97%, dos outliers; no procesar lote. |
| Preproducción | NO AUTORIZADA | Resolver sesión/rate limit/monitoreo/carga, aceptación, ACL y crosswalk. |

## Plan anunciado tras Sprint 10 (histórico)

**Sprint 11 — VALIDACIÓN CON USUARIOS + CORRECCIONES DEL PILOTO + PREPRODUCCIÓN**, sujeto a feedback humano y cierre de estos gates. Mantener DEV guardado; no conectar producción ni servicios remotos. El estado registrado al cierre de ese corte y el trabajo pendiente están en Sprint 12.1 al final de este documento.


## Sprint 12 — cierre

| Gate | Estado | Evidencia |
|---|---|---|
| Search | FAIL | Bench 15 familias/10 repeticiones; sólo colección mejora materialmente. Informe 88. |
| Concurrencia | FAIL | p95 Search 74 s con 10 usuarios y 82 s con 20. Informe 89. |
| Backup | Archivo PASS; restore BLOCKED | `pg_restore` bloqueado por Device Guard; `bjc_dev` sin CREATEDB. Informe 90. |
| Migración limpia | BLOCKED | No se pudo crear DB aislada; DB actual 14/14. Informe 91. |
| OCR V2 | PENDING | Sin ground truth aprobado para 30–50 páginas; no expandir. Informe 92. |
| Viewer/hardening | PASS con límites | Range 206; handler bufferizado; config de destino pendiente. Informes 93–95. |
| Gate integral | NOT READY | UAT/ACL/metadata Digesto PENDING; CIJ/CSJN NO GO. Informes 97–98. |

### Sprint 12.1 — bloqueos técnicos

Sprint 12.1 cerró la medición pero no el gate. Search común sigue p50 6,26 s y a 10 usuarios Search p95 45,57 s. Paridad 40/40, backend/frontend/Playwright PASS. DEV 17/17 migraciones; backup dual con SHA; restore y migration-from-zero PASS en DB temporales ya eliminadas. Ver docs 99–106.

### Trabajo técnico pendiente (alcance acotado)

1. Reestructurar búsqueda en generación de candidatos indexable por nodo AST y carga tardía de relaciones, preservando IDs y ranking; medir con mismo corpus/benchmark antes de adoptar.
2. Reducir heap recheck/sort de Corpus para texto común sin ampliar timeout ni cambiar contrato de coincidencia.
3. Repetir matrices Search y concurrencia tras la solución; restore aislado y migrate-from-zero están cerrados PASS.
4. Mantener UAT, ACL y export Digesto como gates humanos/institucionales independientes.


## Roadmap histórico tras Sprint 12.2 — 2026-10-08

**Sprint 12.2: IMPLEMENTACIÓN SEARCH V2 COMPLETA; gate de preproducción NOT READY.** Candidate sets, boolean executor, late hydration, proyección Corpus, paridad, builds y smoke aislado pasan. La ruta API total y carga 10/20 usuarios no alcanzan el objetivo; no avanzar a Sprint 13 ni red compartida.

**Siguiente alcance técnico:** (1) conectar candidate provider V2 al contrato superior/legacy de `/api/busqueda/avanzada`, preservando filtros, scorer, ACL y DTO; (2) reducir rechecks de texto largo en Corpus PHRASE/PREFIX/SUFFIX y acelerar SHORT; (3) repetir benchmark y concurrencia 1/5/10/20. No aumentar timeouts/pool como sustituto y no seleccionar motor externo hasta medir la ruta integrada.

HUMAN ACCEPTANCE, ACL institucional y export/crosswalk Digesto siguen PENDING; CIJ/CSJN automatizado sigue NO GO. Ver docs 115–116.

## Roadmap vigente tras Sprint 12.3 — 2026-10-08

**Sprint 12.3: READY WITH NON-BLOCKING ADJUSTMENTS** para preproducción controlada/UAT institucional. El endpoint estándar usa V2 con `legacyMs=0`; 40/40 paridad; familias críticas sin errores; backend/frontend builds y Playwright 5/5; matriz local 1/5/10/20 sin errores HTTP/fuente. PostgreSQL queda aceptado para el alcance DEV medido; sin ADR ni migración a motor externo.

**Siguiente acción: Sprint 13 — PREPRODUCCIÓN CONTROLADA + UAT INSTITUCIONAL.** Acordar SLO, ejecutar carga sobre topología de preproducción (TLS/proxy/red), completar aceptación humana y decisión ACL/anonimización/retención, y resolver export/crosswalk Digesto con insumo autorizado. Mantener el piloto en loopback DEV hasta completar dichos gates. CIJ/CSJN automatizado continúa NO GO.

El estado de recuperación también queda reconciliado: restore real y DB temporal desde cero pasaron en Sprint 12.1 (docs 103/104); el replay de schema aislado Sprint 12.2 fue una prueba adicional. Ver docs 124–125 y backups 123.

## Cierre Sprint 13 — 2026-10-08

| Gate | Estado | Siguiente acción |
|---|---|---|
| Preparación documental | DONE | Docs 126–139 listos; usar 126/136 antes de un deploy. |
| Preflight de configuración | IMPLEMENTADO / VALIDACIÓN SINTÉTICA PASS | Código `src/config/preprod-config.ts`; necesita positive/negative startup en host autorizado. Logging level no configurado y rate limit limita a una réplica. |
| Preproducción técnica | BLOCKED / NOT EXECUTED | IT debe identificar host privado, DB y storage separados, autorizar usuarios y completar TLS/proxy/CORS/backup. La falta de ambiente no es falla funcional. |
| UAT institucional | PENDING | Coordinar sesión por perfiles con doc 127; registrar incidencias y aceptación sin usar cuentas sintéticas como evidencia. |
| ACL, anonimización, retención | PENDING | Owners institucionales deciden matrices 129–131; aplicar sólo después de aprobación. |
| Export Digesto | PENDING | Solicitar paquete/crosswalk autorizado conforme doc 80; dry-run y revisión antes de import. Puede marcarse NOT REQUIRED FOR PILOT por decisión del owner. |
| Search / concurrencia real | PENDING | Ejecutar doc 132 en topología autorizada con SLO acordado y carga aprobada 1/5/10. Sprint 12.3 DEV continúa referencia. |
| Production planning | NOT READY | Requiere preprod técnica PASS, UAT suficiente, cero P0, workflow aceptable, ACL/policies y operación listas. |

No se desplegó, migró ni importó nada durante Sprint 13. El próximo trabajo sólo comienza contra el target separado autorizado; mantener DEV loopback sin exposición.

## Sprint 13.1 — bootstrap preparado

Docs 140–145 completan la solicitud de infraestructura, UAT, decisiones, checklist, deploy y resultado. Validator/guard y proyección preprod quedan fail-closed; se preparó un smoke Playwright con HTTPS y configuración explícita. El ambiente sigue **BLOCKED / NOT AVAILABLE**, UAT y políticas **PENDING**. Próxima acción: SYTEC completa doc 140 y provisiona host, DB, storage, DNS/proxy/TLS, vault, backup y service manager autorizados; owners seleccionan corpus y deciden ACL/anonimización/retención. Después ejecutar doc 144 y UAT doc 141. No reabrir Search preventivamente sin nueva evidencia.


## Prioridad vigente — Sprint 14.2

1. Backfill histórico global completado (snapshot 226.770, 20 por página); el checkpoint no conserva páginas fallidas. El siguiente gap de cobertura es acceder al buscador actual en sesión humana para medir primera instancia y nuevas sentencias.
2. El filtro Civil, la descarga y reconciliación SHA y la importación a DEV están completos, salvo `flid=101` (HTTP 404 persistente). No quedan lotes históricos pendientes.
3. Corpus, Search V2 y viewer fueron verificados después de la ingesta; baseline y rendimiento constan en `BJC-ADQUISICION-JURISPRUDENCIA.md` y `BJC-SEARCH.md`.
4. Capturar nuevos fallos del buscador actual sólo después de resolver `cap-widget` en una sesión humana normal; no automatizar CAPTCHA.
5. Reconciliar CIJ cuando exista una ruta oficial autorizada o referencias que puedan cruzarse con datos ya obtenidos.

Fuente operativa: `BJC-ADQUISICION-JURISPRUDENCIA.md`; Search: `BJC-SEARCH.md`.


## Sprint 14.2 — continuidad vigente

El flujo del filtro histórico `tid=18` quedó agotado e importado por lotes. De los 1.277 flids Civil hay 1.263 PDFs validados, 13 ya locales y un 404 persistente; 1.254 nuevos hashes están en Corpus/Search V2. La proyección y el rendimiento fueron medidos después de la ingesta. El crawler global terminó: 226.770/226.770 filas, 11.339/11.339 páginas completas y ningún fallo pendiente. El buscador actual requiere intervención humana ante el captcha para consultar fallos recientes. CIJ sigue sin cifras nuevas. Estado operativo: `BJC-ADQUISICION-JURISPRUDENCIA.md`.

## Sprint 14.3 — continuidad vigente (2026-10-09)

| Tramo | Estado | Evidencia / próximo paso |
|---|---|---|
| Cámara histórica | PARCIAL EN COBERTURA | Corpus: 1.254 docs/1.254 SHA: años 2008, 2009 y 2013. 1.277 IDs fuente; 1 PDF 404. Conseguir canal permitido para ampliar 2013+. |
| Primera instancia | PASS DE PILOTO | 1 sentencia real del Juzgado Civil 64 (2026-10-08) descargada, hashada, importada, extraída e indexada. Feed sólo expone esta muestra visible. |
| `civil:sync` | IMPLEMENTADO; NO EXHAUSTIVO | Lista pública server-rendered con 20 tarjetas; sin paginación observable en GET. Dos corridas idempotentes; no declarar cobertura fiable hasta tener cursor/paginación autorizada o revisión humana frecuente con alcance acordado. |
| Backfill actual | HUMAN_CHALLENGE_REQUIRED; IMPORTADOR HUMANO IMPLEMENTADO | Rango pendiente 2013-08-29→2026-10-09, Cámara + Juzgados. El POST filtrado requiere `cap-widget`; no se envió. Una sesión humana puede guardar HTML/PDFs y continuar offline con `pnpm civil:import:session`; smoke idempotente PASS. |
| CIJ | PARTIAL / SIN ADQUISICIÓN | Dos notas Sala D/M de 2018 sin expediente y un lead 24.971/2024 bajo ruta PDF disallow; 0 cruces confirmables y 0 PDFs nuevos. Solicitar expediente/paquete autorizado o continuar con referencias permitidas. |
| Search Projection | PASS | 12.263 docs, 10.038.148 tokens, ready, stale=0, muestra 100/100. Sin benchmark TERM/PHRASE por delta de sólo un PDF. |

Próximo trabajo basado en cobertura: resolver una vía permitida para backfill Civil 2013→hoy y referencias CIJ con expediente/fecha; luego reanudar `pnpm civil:sync` sólo dentro del canal de descarga autorizado. No abrir preproducción ni rediseñar Search en este alcance.

La recomendación operativa de Sprint 14.2 quedó supersedida por el estado Sprint 14.3 de arriba. El backfill histórico global ya está completo; la brecha activa es la cobertura 2013→hoy y los leads CIJ identificados, con el importador de sesión humana listo.


































## Continuidad inmediata — después de Sprint 14.8 (2026-10-13)

La consolidación terminó en DEV: 4.596 documentos nuevos + 160 vínculos a documentos existentes, 5.176 procedencias y Search proyección verificada con 17.078 documentos y 18.799.500 tokens. 452 grupos siguen retenidos para revisión y los 4.890 enlaces de adquisición permanecen abiertos.

**Continuidad después de Sprint 14.9:** atacar dos cuellos medidos: las lecturas de heap de `CorpusSearchToken` y la reconstrucción repetida del SQL al ampliar la ventana cuando hay pocos resultados exactos (la muestra de 4 resultados ejecutó tres consultas de página adaptativas). Probar materialización única de candidatos conservando exactitud del total y recheck literal; confirmar si el índice covering logra `Index Only Scan`. Mantener paridad 40/40, viewer 6/6 y p95 PHRASE <=1.200 ms como gates. Sprint 14.9 bajó PHRASE p50/p95 de 2.586,78/4.082,32 ms a 1.645,16/1.752,99 ms en harness equivalente, pero una respuesta cold en concurrencia 1 dio error de fuente y el objetivo sigue pendiente. No aumentar timeouts como sustituto.

Tras cerrar el gate técnico, decidir el orden de revisión de los 452 grupos retenidos antes de retomar los 4.890 enlaces abiertos de adquisición. No abrir preproducción ni iniciar acceso institucional nuevo en este tramo.

## Prioridad vigente después de Sprint 14.9.1 — 2026-10-13

**Sprint 14.9.1: PARTIAL; Search PHRASE sigue siendo bloqueo técnico.** La implementación genera candidatos una vez y reutiliza el resultado de las ventanas en un solo statement; el caso de cuatro resultados exactos bajó de 4.431 a 2.094 ms (SQL/request 4→2, generaciones de candidatos 3→1). El benchmark PHRASE comparable, en cambio, pasó de p50/p95 1.632/1.763 s a 2.118/2.323 s; p95 excede 1.200 ms y el benchmark de 15 familias confirma la regresión. No declarar cierre técnico.

**Siguiente alcance:** medir y reducir el agregado/orden de todos los candidatos y el I/O de heap de CorpusSearchToken, usando los EXPLAIN y cardinalidades de _recovery-work/sprint1491/. Mantener frase literal, conteo exacto, orden y página; repetir 10 warm + warmup y cold por separado, 40/40 paridad, projection verify, viewer y concurrencia 1/5/10. No crear índice sin hipótesis/EXPLAIN/estimación de tamaño y benchmark.

No pasar todavía a la revisión de los 452 grupos; queda pendiente hasta obtener PHRASE p95 <=1.200 ms sin romper las validaciones. DEV loopback continúa siendo el único target autorizado.
## Próximo trabajo después de Sprint 15

MVP privado en DEV: implementado; suite backend, builds/typechecks, E2E ACL, Search verify, paridad 40/40 y viewer 6/6 PASS. Endpoint PHRASE tuvo 10/10 requests sin fallo y p95 2.226 ms, mejor que baseline comparable (2.427 ms) pero sobre el gate histórico de 1.200 ms. Próximo: UAT con usuarios/owners de dependencias y mejorar la administración de workspaces. Evaluar retiro lógico en fase posterior. Mantener adquisición histórica como línea separada. No desplegar a red compartida/producción sin infraestructura preprod autorizada y aceptación institucional.

## Después de Sprint 15.1 — 2026-10-13

La administración y UX de espacios fueron completadas técnicamente en DEV y pasaron UAT automatizada sintética; Sprint 15.1 permanece PARTIAL hasta que usuarios reales de juzgados/salas recorran el checklist y registren aceptación/observaciones. Search TERM sintético tuvo variación alta a 1.000 documentos (último p95 2,70 s); perfilarla antes de ampliar el corpus del piloto. Siguiente paso inmediato: coordinar ese UAT humano en DEV con datos ficticios y corregir fricciones observadas. No habilitar red compartida ni producción.

Después de aceptación, elegir una sola línea siguiente: (A) compartir controlado/versionado/papelera; (B) retomar PHRASE Search y su ventana parcial/exact-total; o (C) adquisición histórica y sus grupos/enlaces retenidos. No mezclar las tres. El benchmark privado y sus límites constan en `BJC-ESPACIOS-DOCUMENTALES.md`.

## Prioridad técnica después de Sprint 15.1.1 — 2026-10-13

**Sprint 15.1.1 PARTIAL.** No ampliar el corpus privado ni iniciar todavía otra línea funcional. Se resolvió el nested loop ACL causado por estimaciones obsoletas mediante maintenance settings por tabla; el Hash Join procesa el set autorizado una vez y la ACL aislada a 5.000 queda en p50/p95 9,99/19,26 ms. El conteo exacto y la separación GENERAL/PRIVATE_WORKSPACE siguen correctos.

Siguiente trabajo limitado al residual medido: el candidate CTE TERM consulta `CorpusSearchToken_token_trgm_idx`, produce 113.800 entradas para 5.000 IDs y usa `Unique`/`Gather Merge` más 10.000 lookups por PK. Perfilar el SQL completo de página e hidratación con primera y última página, mejorar candidate deduplication sólo si el EXPLAIN/benchmark lo justifica, y medir por separado el count exacto sin hits (500–590 ms). Repetir tres series a 1.000/5.000 y mantener p95 bajo 400/800 ms, max/p50 estable, seguridad A/B, folder ACL y total exacto antes de ampliar workspaces. No tocar PHRASE en ese tramo; su deuda independiente queda en `BJC-SEARCH.md`.

El backup/migración, benchmark general y validaciones actuales están en `_recovery-work/sprint1511/` (DEV local, ignorado por Git). No declarar cierre por métricas sintéticas ni UAT humana; el piloto requiere después una instancia con usuarios reales y datos ficticios.

## Prioridad de adquisición tras auditoría profunda — 2026-10-13

La línea de jurisprudencia queda en `feature/jurisprudencia`; no integrar aún a `dev`. El runtime mirror para PC oficina está preparado y pendiente de transferencia/restauración local.

1. **P0 — Censo/export autorizado de primera instancia Civil:** solicitar a la autoridad administradora el total por juzgado/fecha, campos estables, paginación/cursor y ruta documental normal. El portal TFN oficial anuncia primera instancia, pero no publica un total agregado; Galilei contiene sólo 1 documento Civil de primera instancia. Antes de estimar backfill, validar una muestra pequeña de metadatos y documentos mediante el canal permitido.
2. **P1 — Revisar los 452 grupos ya adquiridos:** priorizar los 328 conflictos y 106 candidatos; documentar resolución jurídica por grupo y mantener separados 15 pares con archivo distinto, 2 coincidencias exactas y 1 PDF inválido. No auto-fusionar.
3. **P1 — Cuantificar la cola de 4.862 enlaces no intentados:** sólo después de acordar un mecanismo permitido y un muestreo con límites; respetar los 17 challenges, clasificar 10 documentos no disponibles y resolver el único error técnico por la ruta normal. No ejecutar una descarga masiva como parte de esta misión.
4. **P2 — Censo de enriquecimiento CSJN Civil:** consultar la materia Civil del buscador público/seleccionados y medir identificadores/deduplicación antes de incorporar PDFs; el total del filtro no está publicado y Corpus hoy no tiene registros con órgano CSJN.
5. **P3 — CIJ histórico / Datos Abiertos:** dejar en espera hasta obtener un canal institucional autorizado; respetar rutas disallow y demora declarada.

No puede calcularse ganancia documental global ni valor/costo numérico sin un denominador oficial. La prioridad P0 tiene la mayor relación valor/esfuerzo informativo: determina primero el universo real, calendario y ruta de recuperación de primera instancia; la revisión P1 aprovecha documentos ya obtenidos sin iniciar adquisición externa. Evidencia no versionada y matriz por año/Sala: `_recovery-work/jurisprudencia-discovery/`.

## Cierre parcial Sprint J1 — 2026-10-13

Se clasificaron con evidencia de procedencia los 4.596 registros Civil sin instancia y se aplicó `SECOND_INSTANCE` a todos; Search permaneció íntegro. Quedan 451 grupos para revisión humana/asociación soportada (328 conflictos, 106 candidatos, 15 SHA alternativos y 2 matches jurídicos con SHA diferente) y un PDF corrupto rechazado. No hubo adquisición externa, desafío, fusión ni documento duplicado. El coverage engine está preparado para recibir censo oficial CSV/JSON; hoy la cobertura sólo puede medirse dentro del set temático conocido.

**Próximo trabajo recomendado: obtener un censo/export autorizado de primera instancia Civil**, con conteo por Juzgado y una ruta documental normal. Es la brecha sin denominador y hoy Galilei sólo tiene un fallo Civil de primera instancia; solicitar el universo antes de estimar backfill. En paralelo, mantener los 451 casos en export de revisión y definir un contrato de asociación que conserve SHA/identidad de archivo antes de enlazar los dos matches jurídicos exactos. No iniciar descarga masiva ni automatizar desafíos.

## Actualización Sprint J2 — 2026-10-14

El buscador CSJN actual ya confirma consulta de fallos de primera instancia, pero la evidencia oficial revisada no establece que sea un censo Civil completo ni documenta exportación, IDs estables, total/paginación o permiso de automatización. Siguiente acción recomendada: **gestionar el export autorizado** usando el borrador técnico no enviado en `_recovery-work/jurisprudencia-j2/authorized-export-request.md`. No iniciar adquisición del piloto hasta confirmar el permiso y la forma estable del feed. Al recibirlo, validar importador/coverage en fixtures y luego una muestra de hasta 20 documentos aprobados.

El importador y el identity linker v2 quedan read-only/dry-run. Los 451 casos están divididos por causa y los PDFs fuente están presentes; seguir resolución por P0/P1/P2/P3 en el artefacto local, conservando separada la identidad de bytes.

## Después de Sprint J3 — 2026-10-14

J3 quedó CLOSED en readiness: solicitud institucional preparada sin enviar y pipeline local de intake/reconcile/gaps probado con fixtures sintéticos. El siguiente paso técnico independiente recomendado es diseñar la representación de identidad legal/archivos y el orden de revisión de los 451 grupos ya adquiridos, en read-only/dry-run; no fusionar por coincidencia de metadata o por SHA distinto. Si llega el export autorizado antes, priorizar J3.1 para medir sólo `coverage within supplied authorized census`, validar alcance y producir gaps sin descarga masiva.

## Sprint J4 — prioridad después de clasificación (2026-10-14)

J4 cerró el diseño/tooling read-only para 451 grupos: 428 requieren decisión humana, 7 corregir/aclarar datos de fuente, 16 dependen de soporte explícito del modelo y no hubo propuestas `AUTO_SAFE`. No iniciar J4.1 con escrituras. Próximo orden recomendado: (1) revisión humana P0 de las 2 identidades legales y 15 pares de archivo, conservando cada SHA y usando el paquete local; (2) aclarar los 7 metadata conflicts; (3) revisar los 106 candidatos cuando se obtengan candidate IDs/evidencia Corpus; (4) diseñar LegalDecision/DecisionRepresentation sólo tras coordinar el schema entre ramas. El HTML/CSV local y validador no aplican decisiones a DB.

Search PHRASE conserva su gate técnico independiente y este Sprint no modifica runtime, datos ni métricas de búsqueda. J4 artefactos reproducibles/performance están en `_recovery-work/jurisprudencia-j4/`; propuesta de schema sigue UNDECIDED. No hacer adquisiciones nuevas por este orden de revisión.

## Continuidad después de Sprint J5 (2026-10-14)

J5 reconstruyó la cola, el grafo y el paquete HTML/CSV, pero los 106 candidatos siguen sin ID. Continuar con `J5.1 — HUMAN REVIEW UAT` para los 2 casos listos y el paquete estructural priorizado; registrar decisiones y observaciones fuera de DB hasta tener un flujo de asociación aprobado. Mantener los 6 conflictos críticos como pendientes; no inferir un ganador desde firma o título. Los 194 PDFs multi-expediente requieren revisión de alcance antes de cualquier link; no hay propuesta `AUTO_SAFE`. Si llega un export autorizado, priorizar J3.1 para medir sólo el alcance provisto. No iniciar schema/migración mientras `feature/copernic` mantenga cambios Prisma paralelos.

## Continuidad después de Sprint J6 (2026-10-14)

Siguiente paso: `J6.1 — HUMAN REVIEW UAT` sobre las 187 filas `HUMAN_STRUCTURAL_READY`, usando review-v3 HTML/CSV y registrando decisiones fuera de la DB. Revisar separadamente las 134 filas ambiguas/limitadas. Mantener las 107 colisiones sin evidencia como `UNKNOWN`; no inferir procedencia ni corregir metadata. No aplicar links ni diseñar migraciones `LegalDecision` hasta disponer de decisiones verificadas y contrato coordinado entre ramas. El paquete de J6 está en `_recovery-work/jurisprudencia-j6/` y no se versiona.

## Continuidad después de Sprint J6.1 (2026-10-14)

Fase A terminó `READY FOR HUMAN UAT`. La persona debe revisar primero la muestra de 20 casos en `_recovery-work/jurisprudencia-j61/sample-20.json`, usando el filtro “Ver sólo la muestra UAT de 20 casos” de la UI y exportando checkpoints. Aún no hay decisiones humanas. Al recibir el ledger, ejecutar `validate` y `summary`, analizar acuerdo sólo sobre la muestra revisada y recoger observaciones sobre evidencia/tiempo. Sólo si UAT pasa, iniciar `J6.2 — SAFE DECISION APPLICATION DRY RUN`; traducir decisiones a acciones y rollback propuestos, sin writes y con análisis de colisión Copernic. No cambiar schema antes de coordinar ramas.

## Continuidad después de Sprint J7 (2026-10-14)

J7 cerró la auditoría read-only del snapshot: 6.070 documentos, archivos válidos y provenance completa; cero SHA duplicados; 12 grupos de texto normalizado igual con SHA distinto; 4 casos con claves jurídicas múltiples; 1.254 filas sin Sala (principalmente `CSJN_TFN_HISTORICAL`). Las propuestas P1/P2 siguen sin aplicar y no habilitan cambios automáticos. Cuando el usuario vuelva, continuar con **J6.1 — HUMAN REVIEW UAT** según su cola de 187 casos; J7 no alteró la cola ni registró decisiones.

## Continuidad después de Sprint J7.1 (2026-10-14)

J7.1 cerró el dry-run con `READ_ONLY_PASS`, determinismo aprobado en dos ejecuciones y sentinelas DEV idénticos. La anomalía dominante de los 1.092 expedientes/años es límite de parsing (1.089), no evidencia de datos incorrectos; los 1.254 faltantes de Sala coinciden exactamente con la fuente histórica, donde sólo cuatro tienen evidencia inequívoca disponible. Cero reparaciones fueron aplicadas. Próxima recomendación única: **J7.1.1 — NORMALIZER HARDENING**, limitada a parser/tests y fixtures sintéticos, sin modificar metadata del Corpus ni inventar año. J6.1 sigue `READY FOR HUMAN UAT` como flujo independiente; no iniciar UAT ni el siguiente sprint automáticamente.

## Continuidad después de Sprint J7.1.1 (2026-10-14)

J7.1.1 reconoce 1.079/1.089 referencias con reglas determinísticas conservadoras; nueve quedan parciales y una malformada, sin escribir filas ni Search. Próxima recomendación: **J7.1.2 — LEGAL KEY COMPLETENESS / HISTORICAL SALA RECOVERY**, dado que la clave jurídica sigue parcial y hay 1.254 documentos históricos sin Sala. Mantener J6.1 `READY FOR HUMAN UAT` como línea independiente; no iniciar UAT ni J7.1.2 automáticamente. Una futura recalculación persistida del caso/año requeriría primero un dry-run independiente y evaluar la actualización del paquete J6.1 si alcanza sus expedientes.


## Continuidad después de Sprint J7.1.2 (2026-10-14)

J7.1.2 confirmó el universo histórico exacto (1.254/1.254) y cero metadata raw estructurada de Sala. El detector clasificó 365 como propuestas humanas, 39 ambiguas, 849 sin Sala propia y 1 con texto insuficiente. La precisión del encabezado no cumple cero falsos positivos (13 discrepancias en validación conocida), por lo que las cuatro propuestas auto-safe heredadas se degradaron/no reprodujeron y no hay backfill automático. Clave parcial: 1.241 sólo Sala, 2 sólo expediente/año y 13 múltiples. Próxima recomendación: J7.1.3 — HISTORICAL METADATA HUMAN REVIEW PACK para revisión por evidencia, sin aplicar valores; mantener J6.1 UAT separada y sin decisiones humanas. Si no se realizará revisión de esos 365 casos, puede retomarse J6.1 por separado.

## Después de J7.1.3 — UAT acotada de Sala histórica

Tooling `READY FOR HUMAN REVIEW`; revisión humana `NOT STARTED`. Ejecutar primero la muestra local determinista de 25, exportando checkpoints periódicos. Después medir acuerdo con propuesta, Sala alternativa, ambigüedad, falta de evidencia y tiempo promedio. Con esos resultados decidir si conviene revisar los restantes, mantener el faltante histórico como desconocido, solicitar otra fuente o cerrar con gaps conocidos. No revisar automáticamente los 365 ni aplicar Salas; cualquier aplicación futura requiere sprint y revalidación separados.

## Después de Sprint J8 — calidad del corpus cerrada (2026-10-14)

J8 concluyó `CERTIFIED_WITH_KNOWN_GAPS` para los 6.070 documentos Civil actualmente adquiridos: manifiesto 100%, `BROKEN`/`UNKNOWN`/`UNRESOLVED` 0 y escrituras 0. La limpieza técnica de este snapshot queda cerrada; gaps históricos, OCR y colas humanas están documentados. Esto no afirma cobertura total Civil. No abrir una nueva adquisición/scraper como continuación de J8. Líneas siguientes posibles: certificación independiente de endpoint/ranking Search y ruta autenticada Viewer, UX/UAT o preparación de integración coordinada con `feature/copernic`. Detalle y re-ejecución: `BJC-CERTIFICACION-CORPUS-CIVIL.md`.

## Después de Sprint J9.0.1 — UX y Search

J9 está `CLOSED` en DEV tras validar elegibilidad/ACL, workflow público de 6.014 fallos, ciclo PDF navegador, paginación, Viewer, roles, regresión de espacios privados, responsive e idempotencia. 56 registros quedan fuera de publicación y conservados para revisión de identidad legal/modelo; no ejecutar un backfill más amplio hasta resolverlos con evidencia. La consulta media `responsabilidad civil` tiene p50 8.353 ms y p95 10.507 ms con 10 muestras; el próximo alcance técnico es el sprint final de Search, preservando ranking y paridad. Después puede seguir J9.1 de UX/zero-training. Preproducción institucional sigue bloqueada por falta de destino autorizado y UAT; no asumir que el cierre J9 habilita producción. Ver `BJC-OPERACION-JURISPRUDENCIA.md`.

J9.1 implementa la mejora de UX de Jurisprudencia con build, typecheck, lint dirigido y E2E/responsive de interfaz PASS. El cierre es `PARTIAL`: el DEV no tiene sumarios visibles a lectores, la pestaña no publicados muestra universo legado amplio, la captura no verificó un PDF renderizado y UAT humana no se ejecutó. No se alteraron Search, Viewer core, Corpus, datos ni schema. Contrato/evidencia: `BJC-UX-JURISPRUDENCIA.md` y `_recovery-work/jurisprudencia-j91/`.


## Después de Sprint J9.1.1 — 2026-10-14

J9.1 pasa de `PARTIAL` a `CLOSED` en DEV: sumarios reales=0 y soporte sintético PASS; cola operator de 56 derivada y separada; 21.083 históricos fuera de esa cola; PDF real y sintético visibles; print browser PASS; contenido largo/responsive PASS. Conteos siguen 6.014 publicados, 56 casos no publicados. No iniciar scraper, IA/resúmenes, Search optimization, adquisición o RAG desde este cierre. Esperar el cierre UX de `feature/copernic`; luego preparar integración coordinada, sin merge en este sprint. UAT institucional/preproducción/producción siguen pendientes.

## Resultado Sprint 15.2 — 2026-10-13

**PARTIAL de verificación ambiental.** La base funcional de fuentes UNC está implementada y validada con fixtures locales: alta, sincronización incremental, rename inequívoco, reconciliación segura, Search/Viewer privado y ACL ADMIN. Builds y typechecks pasan. No abrir el acceso a dependencias hasta probar la identidad Windows del backend en una UNC aprobada y completar UAT con owners. La paridad legacy 40/40 queda pendiente porque falta el SQLite de referencia en esta PC; Search general, projection verify y Viewer 6/6 sí pasaron independientemente.

Próximos pasos ordenados: (1) obtener/recuperar el SQLite legacy local y repetir parity 40/40; (2) pedir a IT un share de prueba no productivo con permisos de lectura para la identidad de servicio y ejecutar test-access/scan controlado; (3) completar UAT con una dependencia piloto y su política de retención/administración; (4) volver a medir Search PHRASE según el gate previo, sin mezclar esa optimización con escaneo de fuentes. No desplegar en red compartida ni producción en esta Sprint.
## Prioridad después de Sprint 15.3 — 2026-10-13

Sprint 15.3 queda PARTIAL. Se validó Classic Search de tres paneles, preview persistente, filtros de fuente/carpeta, página y teclado en DEV; PHRASE exact-span y refinamientos tipo/fecha continúan sin contrato backend suficiente. Mantener el preview y Search general bajo la ACL actual y no declarar aceptación humana.

Siguiente candidato recomendado: Sprint 15.4A — formatos/OCR con alcance acotado y módulos de extracción separados. Dejar NEAR para después: modificaría parser/AST/executor y coincide con zonas de Search compartidas por feature/jurisprudencia, con riesgo de integración mayor. Antes de 15.4A, acordar la representación de offsets/extracciones para que pueda soportar preview, página y calidad revisable; no inferir OCR correcto por indexación. No mergear ninguna rama al cerrar esta etapa.

Archivos compartidos que requerirán resolución coordinada al integrar ramas: corpus-search.adapter.ts, workspace-document.service.ts, workspace-document.controller.ts, BJC-ESTADO-ACTUAL.md, BJC-ROADMAP.md; los módulos UI de Copernic son nuevos y tienen menor probabilidad de colisión.

## Prioridad después de Sprint 15.3.1 — 2026-10-14

Sprint 15.3.1 queda **PARTIAL**: los filtros privados y el contrato de spans pasan pruebas backend/browser; la limitación restante es probar el mapeo exacto entre texto extraído y text layer PDF.js en más documentos, manteniendo el comportamiento fail-closed cuando no se puede resolver. No afirmar highlight exacto para PDF arbitrario ni promover UAT humana por pruebas sintéticas.

Siguiente paso técnico: recopilar fixtures PDF representativos autorizados/locales, comparar texto de extractor con PDF.js y añadir casos de mapeo (repeticiones, saltos de línea, ítems separados, acentos y ligaduras) sin introducir heurísticas. Luego elegir 15.4A (formatos/OCR) antes que NEAR si sigue siendo el cambio con menos choque con Search compartido por `feature/jurisprudencia`. No hacer merge de otras ramas ni desplegar.

La medición general Search V2 mantuvo p95 de TERM común y PHRASE de dos palabras; el benchmark de PHRASE de tres palabras no se capturó comparablemente en before/after. Los filtros privados tienen p95 de 18–26 ms en el fixture sintético, que no es SLO. Evidencia: `_recovery-work/sprint1531/` (local ignorado).

## Prioridad después de Sprint 15.3.2 — 2026-10-14

Sprint 15.3.2 queda **PARTIAL**. El mapper determinista produjo 0 falsos mappings y el Viewer presenta fallback cuando falta un anclaje confiable; la muestra de 25 PDFs/827 páginas todavía dejó 83/221 spans sin mapping, incluidos TERM frecuentes y PHRASE. No avanzar a la certificación universal de Search→PDF.js.

Siguiente paso técnico: ampliar la muestra local con text layers que separen palabras por espacios geométricos, saltos/guiones y segmentación de extractores distintos; identificar clases TERM/PHRASE que puedan resolverse con anclaje de contexto manteniendo cero falsos mappings. No introducir fuzzy matching ni reconstruir Search. Mantener reporte PARTIAL hasta que los casos habituales tengan highlight determinista o fallback validado por clase.

Cuando el gate visual y los casos habituales cierren, elegir 15.4A — formatos/OCR antes que NEAR mientras `feature/jurisprudencia` siga tocando Search compartido. Hoy esa rama también modifica `CorpusPdfViewer.tsx` y `BJC-SEARCH.md`, `BJC-FUNCIONAL.md`, `BJC-ESTADO-ACTUAL.md` y `BJC-ROADMAP.md`; resolver esas colisiones al integrar, sin merge automático. No tocar ACL, migraciones, producción ni adquisición dentro de esta continuidad.

## Prioridad después de Sprint 15.3.3 — 2026-10-14

Los 83 fallos de mapping anteriores se clasificaron y todos los spans de la muestra base (221/221) quedaron ubicados con 0 falsos highlights auditados. Diez casos reales se revisaron visualmente y el flujo mantiene fail-closed ante discrepancias sin ancla. La nueva muestra de 45 PDFs/968 páginas añade evidencia en 11 productores; queda explícitamente fuera de certificación universal la alineación de seis páginas base con diferencias de glifos, OCR, ligaduras y columnas. El p95 de preparación de página observado subió de la referencia de pasada local 5,832 ms a 8,144 ms, con alineación p95 de 0,888 ms; perfilar y repetir medición antes de ampliar cobertura o afirmar que no hay costo.

Siguiente trabajo recomendado: revisar la diferencia de seis páginas a nivel de categoría sin introducir matching difuso; medir varias pasadas comparables para confirmar el costo de preparación; conservar anclas de contexto exactas, verificación de orden/puntuación y fallback sin highlight. Luego abordar 15.4A (formatos/OCR) con text layer ausente separado de calidad de OCR. Search backend y schema permanecen fuera de alcance; no mergear otras ramas ni tratar pruebas sintéticas como UAT humana.

## Prioridad después de Sprint 15.4A — 2026-10-14

Sprint 15.4A queda **PARTIAL**: detección, formatos textuales, preview/descarga y ACL pasan la evidencia sintética; OCR local y `.doc` seguro no están disponibles. Siguiente línea recomendada: **15.4A.1 — provisionar motor/modelo OCR local y worker acotado, más una ruta segura para DOC**. Es el gate de producto pendiente y de mayor riesgo: motor/modelo aprobado para Windows, calidad con ground truth autorizado, memoria/latencia y backpressure deben preceder a cualquier promesa de OCR. Mantener original y provenance, no OCR masivo ni cloud, y no abrir 15.4B hasta verificar ese pipeline. Artefactos 15.4A: `_recovery-work/sprint154a/`.
## Cierre Sprint 15.4A.1 — 2026-10-14

**CLOSED técnicamente en DEV local; UAT humana y preproducción siguen pendientes.** OCR español local y DOC OLE seguro quedaron implementados, con cola persistente/backpressure/restart recovery, Search incremental, ACL, preview y regresiones. Prisma migración/status, suite backend (128 PASS; 20 opt-in omitidos), builds/typechecks/lint y Playwright OCR/DOC 1/1 pasaron. Tras cleanup, la proyección quedó en 17.078 documentos / 18.799.500 tokens, stale=0, mismatch=0/100, rebuild=0. El benchmark DOC p95 fue 57,57 s frente al timeout de 60 s; mantener este límite visible para cargas por lotes.

Siguiente alcance recomendado: **Search + Viewer final certification**, con golden query suite, paginación, ACL, match/mapping, todos los formatos, OCR, carreras del Viewer, F3, resize, errores y rendimiento. No iniciar NEAR, Semantic Search o RAG automáticamente. Mantener local-only hasta cumplir preproducción y aceptación humana; la muestra OCR actual es sintética y no certifica calidad jurídica de documentos reales.
## Prioridad después de Sprint 15.5 — 2026-10-14

Search + Viewer cerró sus gates técnicos principales con estado CERTIFIED_WITH_KNOWN_LIMITATIONS en DEV. No iniciar NEAR, semantic search, RAG ni adquisición dentro de esta continuidad. Próximo foco opcional: UX-1 Zero-Training UX, después de preparar integración coordinada entre ramas; UAT institucional, preproducción y hardening de la matriz XSS/SQLi/WCAG deben continuar como gates separados. No se inició UX automáticamente.

## Sprint 15.6 — resultado y próxima decisión (2026-10-14)

La UX de entrada, dependencia, carpetas compartidas, Search, preview y upload se hizo más clara. E2E autenticado 2/2 y matriz responsive 7/7 sin overflow pasaron; no se completó UAT humana. La misión cero capacitación completa queda **PARTIAL**: el backend no implementa documentos personales ni ACL por carpeta. No anunciar ni emular «Mis documentos — sólo yo» o «Restringido — usuarios elegidos» hasta contar con datos, autorización uniforme en todas las rutas y regresiones anti-leak. La integración Workspace PostgreSQL no certificó su expectativa de una sola ejecución OCR en presencia de un backend activo; ver detalle en `BJC-ESTADO-ACTUAL.md`. Contrato de UX y alcance: `BJC-UX-ESPACIOS-DOCUMENTALES.md`.

Próximo trabajo permitido: integración coordinada de ramas sólo después de comparar las decisiones de UX y los contratos ACL; luego diseñar un alcance backend dedicado para propietario personal y carpetas restringidas, con regresión DB/API/árbol/Search/count/preview/download/upload/move antes de activar controles. Human UAT sigue pendiente. No comenzar Search features, RAG, NEAR, scraping ni adquisición por esta conclusión.

## Sprint 15.6.1 — resultado histórico y siguiente paso (2026-10-14)

**CLOSED técnicamente en DEV local.** Se completaron documentos `GLOBAL_PER_USER`, carpetas compartidas/restringidas con grants a membresías activas, revocación inmediata en Search/Viewer/download, transiciones con confirmación y seguridad para documentos sincronizados. Herencia es acumulativa: no se puede ensanchar un hijo dentro de una carpeta restringida; se debe cambiar primero el alcance del padre. La corrida OCR histórica se volvió determinística usando cola y storage únicos por ejecución; seis integraciones Workspace consecutivas pasaron. E2E, Search golden, Source, Prisma y Search Verify también pasaron; DB/storage sintético se limpiaron y el baseline quedó intacto. Detalle/evidencia: `BJC-ESTADO-ACTUAL.md`, `BJC-ESPACIOS-DOCUMENTALES.md` y `_recovery-work/sprint1561/`.

Siguiente paso: preparación de integración coordinada de `feature/copernic` con `feature/jurisprudencia`, con revisión conjunta de los archivos compartidos (`workspace-document.service.ts`, controllers/Search y los documentos de estado/contratos). Esta conclusión no realiza merge/cherry-pick. Mantener UAT humana, verificación UNC aprobada, preproducción y producción como gates independientes. No iniciar NEAR, semantic search, RAG, scraper, AI summaries ni adquisición dentro de esta continuidad.

## Decisión pendiente — contrato de subcadena Search (2026-10-15)

SEARCH-SEMANTICS-AUDIT-1 queda **SUBSTRING_UNCERTAIN**. No ejecutar cambios de contrato ni benchmarks de motor hasta que Biblioteca/Civil responda el pack UAT de `_recovery-work/search-semantics-audit1/human-uat-pack.json`. La diferencia funcional es acotada en dos frases clave (8/5.372 y 8/202 current-only en el snapshot), pero eso no determina intención ni rendimiento PostgreSQL. Si UAT confirma que los términos simples deben encontrar fragmentos dentro de palabras, continuar evaluación de motor especializado; si no, preparar por separado un cambio de contrato con compatibilidad y rollback. Copernic runtime no disponible; no inferir su comportamiento desde el PHP histórico de Jurisprudencia. Sin cambios productivos, DB, migraciones, instalación de motores, commit o promoción.
## SEARCH-CONTRACT-CHANGE-1 — cierre Search lexical (2026-10-16)

1. Decisión humana cerrada: TERM/PHRASE completos; coincidencia parcial sólo con comodín explícito; sin stemming.
2. Prototipo FTS simple y fixtures semánticos pasan 16/16; el modelo token existente carece de posiciones.
3. Siguiente gate: backup DEV nuevo verificado, medir una expresión GIN FTS posicional sobre corpus real, totales/página/booleanos y comodines por separado, sin tocar las 28 migraciones existentes.
4. Si TERM/PHRASE cumplen p95 <1 s preferido, <2 s máximo y cero timeouts, integrar la ruta lexical, agregar los Golden humanos, verificar ACL/paginación/Viewer/Search Verify y builds. Cualquier índice será migración aditiva #29 con mantenimiento automático por cambios en searchText.
5. Si PostgreSQL falla el máximo bajo el contrato lexical, no integrar el adapter: preparar SEARCH-ENGINE-EVAL-2 con la semántica nueva. No promover dev ni tocar main en este cierre.

## Resolución de contrato Search y resultado lexical (2026-10-16)

La incertidumbre de `SEARCH-SEMANTICS-AUDIT-1` fue resuelta por validación humana: la subcadena automática en TERM/PHRASE era accidental; Copernic no encontraba `CIVIL` dentro de `CIVILIZACIÓN` según observación de la persona usuaria. El contrato lexical se documentó, pero no se integró. El primer FTS simple tenía falsos negativos por límite posicional y se rechazó. El híbrido por ventanas recuperó los conteos críticos, pero “responsabilidad civil” quedó en p95 combinado 2,467 ms, por encima del límite 2 s. Continuar, si se prioriza, con `SEARCH-ENGINE-EVAL-2` bajo el contrato lexical; reevaluar los motores con el contrato actualizado, sin usar mediciones de substring anteriores como comparación directa. No migrar, integrar ni promover DEV hasta cerrar exactitud de IDs, consultas representativas, performance y concurrencia.

## Gate semántico reabierto — SEARCH-SEMANTICS-AUDIT-2 (2026-10-16)

La recomendación previa de pasar a SEARCH-ENGINE-EVAL-2 queda suspendida por evidencia humana contradictoria. H1 recuerda TERM y PHRASE léxicos y que Copernic no encontraba CIVIL dentro de CIVILIZACIÓN; H2 recuerda que TERM sí encontraba CIVIL dentro de CIVILIZACIÓN con resaltado sólo del fragmento CIVIL. H2 deja PHRASE pendiente y los comodines incompletos. No promediar testimonios ni inferir PHRASE desde TERM.

Estado: SUBSTRING_UNCERTAIN / CONFLICTING HUMAN LEGACY RECOLLECTION. Siguiente paso: completar _recovery-work/search-semantics-audit2/copernic-human-test-pack.md en el runtime histórico, con capturas de consulta, resultado y resaltado cuando estén disponibles. El caso decisivo de PHRASE es “RESPONSABILIDAD CIVIL” frente a un resultado que sólo contenga “SUPERRESPONSABILIDAD CIVILIZADO”; si no hay ejemplo reproducible, registrar TEST_NOT_PROVABLE_WITH_AVAILABLE_CORPUS y mantenerlo pendiente.

No ejecutar SEARCH-ENGINE-EVAL-2, PGroonga ni cambios productivos hasta cerrar los operadores por separado. Según la evidencia futura: TERM+PHRASE substring → recomendar SEARCH-ENGINE-EVAL-SUBSTRING; TERM substring y PHRASE lexical → SEARCH-CONTRACT-HYBRID-1; ambos lexical → SEARCH-CONTRACT-CHANGE-1. La clasificación sigue UNKNOWN para TERM, PHRASE, PREFIX, SUFFIX y CONTAINS. INT-1S permanece BLOCKED / WAITING HUMAN SEMANTIC DECISION; INT-1R BLOCKED; DEV NOT PROMOTED; UX-2 NOT STARTED. Esta adenda conserva la historia y suspende sólo la recomendación de motor anterior.

## Próximo Search — SEARCH-CONTRACT-COPERNIC-1 (recomendación, 2026-10-16)

Contrato objetivo cerrado: `COPERNIC_PREFIX_EXACT_PHRASE` (TERM prefix + PHRASE exacta). El sprint siguiente debe prototipar PostgreSQL con búsqueda léxica por prefijo y frase posicional; agregar al Golden los seis casos planificados y medir consultas representativas, conteos, ranking, paginación, ACL y spans/highlight. Todo cambio de esquema debe ser aditivo, con backup DEV verificado, migración revisada y rollback. Esta auditoría no tocó Golden ni aplicó migraciones.

Medir p50/p95, concurrencia y EXPLAIN con corpus equivalente y los umbrales ya acordados. Si PostgreSQL cumple exactitud y rendimiento, conservarlo. Sólo si falla el gate, reabrir evaluación externa bajo prefijo + frase exacta; resultados anteriores de substring no son comparables. No ejecutar motores, benchmarks ni crear índices en este cierre.

term% ya implementa prefix y se solapa con plain TERM; resolver después si será alias. %term (suffix) y %term% (contains) quedan como extensiones avanzadas Galilei para revisión, sin afirmar equivalencia Copernic. Runtime histórico no verificado directamente; documentación oficial y sus límites están en _recovery-work/search-semantics-audit2/external-copernic-evidence.json.


## SEARCH-CONTRACT-COPERNIC-1 — cierre PostgreSQL-first (2026-10-16)

**NO GO PostgreSQL** para `COPERNIC_PREFIX_EXACT_PHRASE`. Los candidatos sobre estructuras existentes A/B fallaron el máximo de 2 s en la frase crítica (2.114/2.112 ms antes de timeout); no hay igualdad de IDs certificada. La variante C FTS por páginas no se ejecutó: cobertura de página vigente 16.683/17.077 documentos elegibles, sin índice posicional, y FTS anterior tuvo falsos negativos y un híbrido con p95 2.467 ms. No se añadieron índices ni se incurrió en coste de build.

**Siguiente paso requerido:** SEARCH-ENGINE-EVAL-2 con contrato TERM=PREFIX + PHRASE=EXACT; resultados de OpenSearch bajo substring no son evidencia comparable. INT-1S BLOCKED BY ENGINE; INT-1R BLOCKED. No promover a DEV. No se modificaron producto, Golden, schema, migraciones ni la rama de UX. Evidencia: `_recovery-work/search-contract-copernic1/`.

## SEARCH-ENGINE-EVAL-2 — salida y siguiente sprint (2026-10-16)

EVAL2 cerró con ADOPT OpenSearch 2.19.6 como candidato bajo COPERNIC_PREFIX_EXACT_PHRASE. El resultado no integra el motor. PostgreSQL conserva autoridad del corpus; sus prototipos Search siguen REJECTED. En los 17.077 documentos elegibles, 100 frases y 14 prefijos tuvieron igualdad exacta de IDs, las frases críticas combined p95 fueron 81,84/109,65 ms, 319 Golden + 12 fixtures pasaron, ACL no filtró resultados/conteos, y el rebuild reprodujo el hash completo de IDs.

Siguiente: SEARCH-ENGINE-INTEGRATION-1 para diseñar/implementar índice derivado con sincronización idempotente/outbox o CDC, borrados/tombstones, publicación y ACL aplicadas antes de contar, hidratación de página desde PostgreSQL, fail-closed, versionado/alias con rollback, autenticación/TLS, límites y observabilidad. Repetir exactitud y performance dentro de la integración antes de cualquier promoción. No desplegar el perfil de evaluación con Security plugin deshabilitado. INT-1S espera integración del motor; INT-1R sigue BLOCKED; DEV NOT PROMOTED; UX-PREP CLOSED/UNTOUCHED. Evidencia: _recovery-work/search-engine-eval2/.


## Próximo: cierre de gates SEARCH-ENGINE-INTEGRATION-1.1 (2026-10-16)

La integración queda **BLOCKED** aunque pasaron los gates de rebuild exacto, outbox/outage/retry, rebuild race, Golden, sets de frases/prefijos y rendimiento adapter + PostgreSQL. No repetir EVAL-2.

1. Completar la migración de todas las rutas Search al adapter OpenSearch; mapear filtros/sorts soportados y rechazar explícitamente los no soportados sin búsqueda legacy.
2. Probar en endpoint NestJS el fallo cerrado con OpenSearch detenido, sin fallback; certificar phrase/prefix, conteos exactos, páginas first/second/middle/last, estabilidad, Viewer, spans y UTF-16.
3. Ejecutar ACL real engine-side (owner, miembro, no miembro, restricted y variantes same-SHA) y publicación/revocación, reportando leaks de resultados y conteos; observar cambios PDF/OCR/DOC/metadata/ACL/publicación.
4. Ejecutar mixed workload (100 frases, 14 prefijos, 30 mixtas) y concurrencia 5/10 por ruta HTTP; reportar p50/p95/p99/max y timeouts.
5. Completar handshake TLS/auth real, revisión de secretos y replay de migración desde base limpia. La migración limpia no es el último gate; no solicitar CREATEDB todavía.
6. Repetir test/build/lint/verificación total; recién si todos los gates pasan, revisar cada archivo y publicar sólo a origin/integration/galilei-beta. No promover DEV ni integrar UX en este sprint.

## SEARCH-ENGINE-INTEGRATION-1.2 — gates que continúan abiertos (2026-10-16)

La integración permanece **BLOCKED**. El inventario de 31 rutas encontró tres handlers con ejecución/fallback legacy condicional (`/busqueda/avanzada`, `/busqueda/simple`, `/public/busqueda`) y cuatro rutas de resultados legacy-only (exportación, cita, sentencias y sumarios). No afirmar cero fallback.

Hallazgo de cobertura que debe resolverse antes de la certificación pública: el DEV actual tiene 6.014 Sentencias activas/publicadas sin Sumarios activos, pero la proyección de Jurisprudencia indexa por Sumario. Una llamada real a `/api/public/busqueda` devolvió dos Sentencias publicadas para `responsabilidad civil`; OpenSearch devolvió cero. No se observó fuga en esas filas, pero hay divergencia de resultados entre motores.

Siguiente trabajo acotado: (1) definir/proyectar la identidad Search de Sentencias publicadas que no tienen Sumario sin duplicar documentos; (2) implementar todas las rutas y filtros/sorts del contrato en OpenSearch con respuesta compatible; (3) probar por HTTP una indisponibilidad con contador que demuestre cero invocaciones legacy; (4) completar publicación, ACL/same-SHA/revocación y sync OCR/DOC/metadata; (5) ejecutar Golden 325, frases 100, prefijos 14, comodines, booleanos, paginación, rendimiento y concurrencia sobre HTTP; (6) cerrar Viewer/UTF-16, TLS/auth, lint acotado, cleanup y artefactos. Sólo con todos los gates PASS evaluar commit y push a `origin/integration/galilei-beta`; nunca promover DEV en este sprint.

## Resultado final de PREPROD-UAT-PREP-1 (2026-10-18)

| Gate | Resultado | Evidencia / condición restante |
|---|---|---|
| Paquete de despliegue | READY_FOR_INFRA_ACTIONS | Guardas, plantillas placeholder, deploy script y runbooks listos en `feature/preprod-uat-prep`; commit/build/test evidence en artefactos ignorados. |
| Instalación/build limpio | PASS | Checkout detached; pnpm frozen backend/front, Prisma generate sin DB, builds backend/front. Front build usa dominio reservado `.invalid`. |
| Tests sin infraestructura | PASS CON ALCANCE | 36 suites/231 tests PASS; 1 suite y 9 tests SKIP en esa corrida. Además, 9 suites fueron excluidas explícitamente (8 requieren DB aislado y 1 fixture SQLite externo). No consultar DB canónico DEV. |
| PREPROD infraestructura | NOT PROVISIONED | Owner/host, PostgreSQL 16, OpenSearch, TLS/DNS/proxy, storage/capacidad, firewall/vault aún no entregados (doc 140). |
| Backup/restore PREPROD | NOT PROVEN | Requiere backup de DB+storage y restore drill en reemplazo aislado. Evidencia DEV/INT previa no sustituye el target. |
| UAT institucional | NOT STARTED | Plan READY; ambiente AFTER_INFRA; sin cuentas ni invitaciones. |

No se habilita despliegue ni invitación de usuarios hasta completar infraestructura, restore, smoke real, matriz ACL/corpus aprobada y responsables institucionales.

## Siguiente gate — collation V4 (2026-10-20)

| Gate | Estado | Evidencia / condición |
|---|---|---|
| Implementación V4 shadow | PASS técnico | Reindex 69.313/69.313, cero fallos; ID/source parity exacta; Golden ASC/DESC sin diferencias. |
| Search público e interno | PASS en smoke candidato | Orden, referencias, filtros, paginación y export verificados; cero 503 en el benchmark. |
| Search privado / ACL | PASS | Fixtures aislados: personal, workspace, shared, restricted, folder y no-member; 5 candidatos PIT → 2 autorizados antes de total/página, 0 IDs denegados. Nueve solicitudes HTTP p50 20,30 ms / max 48,76 ms. Limpieza V4/DB PASS. |
| Alias / V3 | PASS seguridad | `galilei-search-active` sigue en V3; cero writes a V3. |
| Commit / push / promoción | CANDIDATO LISTO; promoción no realizada | Commit/push únicamente a `feature/jurisprudencia-collation-v4-implement1` tras calidad final; no tocar alias, `dev`, `main` ni UX. |

Próximo paso: revisión independiente `JURISPRUDENCIA-COLLATION-V4-REVIEW-1`. V4 queda como shadow; no cambiar alias. Los fixtures fueron sintéticos y se limpiaron del DB DEV y del índice V4; el conteo final regresó a 69.313 y el outbox a 217.809/0 pendientes/0 fallidos. Re-certificar la colación si cambia la versión ICU de Node u OpenSearch.

## JURISPRUDENCIA-V4-FRESH-BOOTSTRAP-TOOLING-1R — gate en curso (2026-10-21)

El objetivo es añadir un camino soportado que cree V4 directamente en un OpenSearch vacío, reutilizando mapping/proyección V4 y sin requerir V3. El trabajo candidato está en `feature/search-fresh-v4-bootstrap1r`, basado exactamente en `origin/dev=ebefee54a5208187b7f77b84d71d7addd043f653`. La validación se limita al runtime aislado de `19200/19300`; el índice `galilei-search-v004-20261021t082000000z-1a2b3c4d` sigue en proyección y el alias aislado permanece ausente.

Siguiente: completar proyección y paridad, probar Golden ASC/DESC, Search y ACL, lifecycle/outbox, restart y regresión principal; cerrar typecheck/build/tests y escaneo de secretos/archivos grandes. La promoción a `origin/dev` queda bloqueada hasta una revisión independiente PASS con cero hallazgos P0/P1. No cambiar `main`, Search principal, migraciones ni Sytec10; si un gate no puede completarse, dejarlo como bloqueante y conservar el candidato sin promoción.
# GALILEI-RESEARCH-CONTINUITY-SPRINT-1 — candidata (2026-10-25)

Sprint paralelo desde UAT congelado `e06139e3075ef20a90d586973a7d301515ee5a67` en `feature/research-continuity-1`. Implementa continuidad de investigación pública: enlace canónico, favorito, cita autoritativa + enlace Galilei, explicación española desde el parser, ayuda y consulta guardada privada por usuario usando el modelo/API actual. No requiere migración ni escritura en servicios principales. Typecheck/lint/tests/build pasaron; Playwright aislado 3/3. Las cifras históricas de Search no se reejecutaron porque el API local no escuchaba en `127.0.0.1:4000`; no se ejecutó el golden de integración que escribe fixtures. No se alteró el camino de Search, ranking, conteos, orden, filtros ni Search index. Resultado `PASS_WITH_FINDINGS`, sólo la rama feature se publica. Evidencia: `docs/features/research-continuity.md`.


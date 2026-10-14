# Estado actual — Buscador Jurídico Civil

## Auditoría de paridad de source — 2026-10-13

**Resultado: SOURCE EQUIVALENCE PASS en `dev`.** El clone limpio del commit `373e7c0add34580baade5fe873849c97f2fda061` instaló backend y frontend con `pnpm install --frozen-lockfile`; Prisma validate/generate, backend/frontend typecheck y builds pasaron. La suite backend sin runtime pasó 90 tests; 19 tests/suites optativos quedaron omitidos. No se copió runtime ni SQLite histórica.

La causa confirmada fue `.gitignore` raíz `**/logs/`, que ocultaba cinco fuentes `JurisprudenciaN/back/src/logs/` y la página `JurisprudenciaN/front/src/app/(admin)/admin/logs/page.tsx`. Se versionaron las seis, se limitaron las reglas de logs a rutas runtime y el test de paridad SQLite ahora se omite si no existe el fixture. Los JSON de ejecución en `JurisprudenciaN/back/logs/` siguen ignorados por su regla local. El fixture SQLite histórico es runtime de referencia optativo; no se subió.

La auditoría inspeccionó 589 archivos source-like bajo rutas compilables: 576 ya versionados y 13 candidatos ignorados/no versionados; se añadieron los seis archivos de código requeridos. Los otros siete candidatos son salidas JSON runtime, configuración IDE local y `next-env.d.ts` generado. Ninguno de los seis archivos añadidos tuvo coincidencias en el escaneo de secretos; el mayor agregado mide menos de 9 KiB. `pnpm exec eslint .` en frontend sigue reportando cuatro errores preexistentes de `react-hooks/set-state-in-effect` en páginas Corpus/Digesto/Revisión y una advertencia de variable no usada en `ProtectedContent.tsx`; no bloqueó typecheck/build ni pertenece a esta corrección.

## Sprint 14 — corte vigente 2026-10-13

**Resultado vigente:** Sprint 14.8 ingirió el lote civil local; Sprint 14.9.2 dejó PHRASE en PARTIAL / PHRASE REGRESSION REMAINS (p95 comparable 2.427,38 ms; early exit no certifica total exacto). La auditoría posterior de fuentes Civil clasificó 5.738/10.600 enlaces y confirmó 4.862 sin intento, 17 challenges, 10 no disponibles y 1 error del visor; 452 grupos continúan en revisión. No se conoce un denominador oficial integral de cobertura. Ver corte de Sprint 15.1.1 + auditoría Civil al final de este documento.

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


## Cierre Sprint 12 — estado vigente (2026-10-08)

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

Las secciones históricas anteriores conservan sus cifras de cada corte; esta tabla representa el estado vigente.

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


## Cierre Sprint 12.2 — estado vigente (2026-10-08)

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

Este es el corte vigente de preproducción/UAT; conserva Sprint 12.3 como último resultado técnico de Search en DEV.

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


## Sprint 14.2 — corte vigente

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

## Estado vigente — cierre Sprint 14.9.1 (2026-10-13)

Search continúa en DEV local y PARTIAL / PHRASE REGRESSION REMAINS. La proyección conserva 17.078 documentos y 18.799.500 tokens, stale 0 y 0 discrepancias en muestra de 100. Candidate set y ampliación PHRASE ahora se ejecutan en una sola consulta SQL además del readiness; el caso medido de cuatro resultados bajó de 4.431 a 2.094 ms y de 4 SQL a 2. La corrida comparable PHRASE de 10 requests dio p50 2.118 ms/p95 2.323 ms, peor que el baseline 1.632/1.763 ms y fuera del gate de 1.200 ms.

Paridad 40/40, viewer 6/6, pruebas parser/adapter 34/34, PostgreSQL 7/7, Corpus 3/3, suite general 93 PASS/15 omitidos, schema verify 44 tablas/21 migraciones PASS, typecheck y build PASS. VACUUM (ANALYZE) mejoró visibilidad a 99,985%, pero no logró Index Only Scan. Mantener Search local; el siguiente cuello medido es la lectura heap y el orden/agregado de todo el set candidato PHRASE. No continuar con los 452 grupos hasta cerrar este gate. Evidencia y límites en BJC-SEARCH.md y _recovery-work/sprint1491/.
## Estado vigente — Sprint 15 (2026-10-13)

**MVP de espacios privados IMPLEMENTADO en DEV.** Migración `20261013130000_sprint15_private_document_workspaces` aplicada en `bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev`, con backup pre-migración verificado ya existente en Sprint 14.9. E2E PostgreSQL sintético PASS: workspace A/B, mismo SHA/blob con documentos lógicos distintos, idempotencia por SHA dentro del mismo workspace, resultados aislados, general sin privados, acceso cruzado y acceso global por ID 404, lectura autorizada directa, carpetas/movimientos, membership y restricciones VIEWER. Suite backend 94 PASS/15 omitidos; typecheck y builds backend/frontend PASS; Search verify stale=0/mismatch=0, paridad 40/40 y viewer 6/6 PASS; schema 49 tablas/22 migraciones PASS. Benchmark canónico endpoint tras warmup + 10 requests: TERM común p50/p95 202/266 ms; PHRASE 1.934/2.226 ms; 0 fallos. Baseline comparable Sprint 14.9.2 PHRASE 2.272/2.427 ms; PHRASE mejora, pero supera el objetivo histórico de 1.200 ms y permanece PARTIAL. Espacio sintético de 1 documento: TERM p50/p95 3,9/5,4 ms; PHRASE 86,6/176,6 ms (3 muestras, no SLO).

El storage de prueba queda aislado bajo `_dev-corpus-storage-test/sprint15-workspaces` y se limpia con la suite. No se reindexó el corpus existente (17.078 documentos / 18.799.500 tokens) ni se editaron documentos de adquisición. Search PHRASE continúa PARTIAL según `BJC-SEARCH.md`. Este estado es sólo local DEV; preproducción, producción, UAT y acceso institucional siguen pendientes. Detalle y contratos: `BJC-ESPACIOS-DOCUMENTALES.md`.

## Estado vigente — Sprint 15.1 (2026-10-13)

**Sprint 15.1 PARTIAL; listo técnicamente para organizar un piloto en DEV, pendiente de UAT con personas reales.** Se implementaron en UI administración de workspaces y miembros, selección de alcance, búsqueda en espacio/carpeta/nombre, carpetas, carga 1–20 archivos con resultados por archivo, actividad y errores legibles. Playwright sintético pasó 2 escenarios en 1366×768/1920×1080; backend verificó ACL positiva/negativa, viewer y descarga cruzada 404, aislamiento de Search general y casos same-hash. Typecheck, builds, suite backend, Prisma y checks de Search previos PASS. No hubo acceso ni despliegue institucional.

Dataset sintético privado 100/500/1.000: última corrida TERM p50/p95 38,15/42,20; 446,55/457,30; 386,62/2.698,19 ms, total exacto. Corridas repetidas variaron hasta 2,30 s p50/2,39 s p95 a 1.000. PHRASE 141,39/143,90; 413,39/418,18; 297,42/312,57 ms, parcial (100 resultados) en 500/1.000. Count ACL aislado delta p50/p95 0,84/0,93; 59,34/66,64; 28,05/36,18 ms. `EXPLAIN ANALYZE` en 500 mostró índice Corpus por scope/status, luego nested loop ACL con 500 loops de 250 filas (124.750 descartadas), 81,81 ms/3.132 buffers hit. Microbenchmark variable, no SLO; seguir el predicado ACL y variación TERM antes de ampliar corpus. Overhead membresía+respuesta 2,49/4,76/7,01 ms TERM y 2,77/6,73/6,08 ms PHRASE. PHRASE heredó su deuda exact-total y no fue reimplementado.

Search general: 17.078 documentos, 18.799.500 tokens, stale=0, mismatch 0/100; paridad 40/40 y viewer 6/6. Aceptación por personal de juzgados/salas sigue PENDING y TERM sintético a 1.000 documentos mostró hasta 2,70 s p95, por lo que no declarar el Sprint CLOSED ni escalar el corpus del piloto sin seguimiento de rendimiento. Ver detalles y checklist ejecutado en `BJC-ESPACIOS-DOCUMENTALES.md`.

## Estado vigente — Sprint 15.1.1 (2026-10-13)

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

## Estado vigente — Sprint J1 (2026-10-13)

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

## Sprint J5 — estado vigente (2026-10-14)

El review package de 451 grupos ya contiene procedencia y evidencia por expediente. Ningún candidato de los 106 se pudo recuperar; 194 conflictos estructurales tienen varios expedientes exactos impresos en un mismo PDF y 127 siguen como colisiones de metadata. De 7 metadata conflicts, un expediente fuente quedó corroborado junto con otro expediente Corpus en el PDF; 6 conservan campos críticos pendientes. No se aplican links ni se cambia legal metadata.

Readiness: 2 listos para decisión humana, 106 sin candidato, 6 con datos críticos pendientes, 321 estructurales y 16 limitados por modelo. El paquete está en `_recovery-work/jurisprudencia-j5/`; tests CJS 19/19 y determinismo 10/10 pasan. DEV permanece en 17.078 documentos, 17.098 archivos, 17.685 ingestas y 18.799.500 tokens; Search verify: 0 stale, 0 mismatch/100 y 0 rebuild. El timestamp `verifiedAt` se devolvió al valor previo de J4 tras detectar que el comando de verify lo refresca. No hay cambios finales de contenido en Corpus/Search, Prisma ni migraciones. **Cierre técnico: PARTIAL**, porque ese refresco transitorio incumplió el gate estricto de cero escrituras aunque se restauró el valor previo.

## Sprint J6 — estado vigente (2026-10-14)

J6 completó el análisis reproducible de los 321 grupos y la cola de revisión V3. Pruebas Node: 15/15 PASS; artefactos deterministas: 11/11 PASS. La DB DEV se mantuvo read-only, con cero intentos de mutación y sentinelas sin cambios. Search: 17.078 documentos, 18.799.500 tokens, 0 stale, 0 diferencias en muestra 100; `verifiedAt` estable.

Resultado `PARTIAL`: la identidad primaria tiene 187 propuestas confirmadas/probables listas para revisión estructural y 134 ambiguas/limitadas; las 127 colisiones de metadata incluyen 107 sin procedencia suficiente. No se aplicaron links ni correcciones, y no se decidió schema. Paquete local ignorado: `_recovery-work/jurisprudencia-j6/`.

## Sprint J6.1 — estado vigente (2026-10-14)

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

La app estática local presenta la sugerencia de máquina separada de la decisión humana, resalta contexto, advierte sobre citas de otras Salas y no expone paths PDF. Permite filtros, búsqueda, decisión explícita, undo, export/import de checkpoint con stale detection y export JSON/CSV. El filtro UAT muestra exactamente los 25 casos deterministas. Entrada reproducible: `node scripts/with-dev-db-guard.cjs sprint-j713-historical-sala-review-pack`; luego iniciar desde `JurisprudenciaN/back`: `node scripts/dev/jurisprudencia-historical-sala-review-server.cjs`. El server escucha sólo en `127.0.0.1:43173`. Evidencia y checkpoints permanecen ignorados en `_recovery-work/jurisprudencia-j713/`.

Generación read-only y sentinelas PostgreSQL/Search iguales; J6.1 sigue intacto. Playwright pasó el flujo completo con datos sintéticos y un smoke test del paquete real verificó los 365/39 casos y el filtro de 25; se registraron cero decisiones sobre casos reales. Próximo paso humano recomendado: sólo la muestra de 25; no asumir que deben revisarse los 365.

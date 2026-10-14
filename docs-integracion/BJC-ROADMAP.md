# Roadmap operativo — Buscador Jurídico Civil

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

**Sprint 11 — VALIDACIÓN CON USUARIOS + CORRECCIONES DEL PILOTO + PREPRODUCCIÓN**, sujeto a feedback humano y cierre de estos gates. Mantener DEV guardado; no conectar producción ni servicios remotos. El estado vigente y el trabajo pendiente están en Sprint 12.1 al final de este documento.


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

## Sprint 15.6.1 — resultado vigente y siguiente paso (2026-10-14)

**CLOSED técnicamente en DEV local.** Se completaron documentos `GLOBAL_PER_USER`, carpetas compartidas/restringidas con grants a membresías activas, revocación inmediata en Search/Viewer/download, transiciones con confirmación y seguridad para documentos sincronizados. Herencia es acumulativa: no se puede ensanchar un hijo dentro de una carpeta restringida; se debe cambiar primero el alcance del padre. La corrida OCR histórica se volvió determinística usando cola y storage únicos por ejecución; seis integraciones Workspace consecutivas pasaron. E2E, Search golden, Source, Prisma y Search Verify también pasaron; DB/storage sintético se limpiaron y el baseline quedó intacto. Detalle/evidencia: `BJC-ESTADO-ACTUAL.md`, `BJC-ESPACIOS-DOCUMENTALES.md` y `_recovery-work/sprint1561/`.

Siguiente paso: preparación de integración coordinada de `feature/copernic` con `feature/jurisprudencia`, con revisión conjunta de los archivos compartidos (`workspace-document.service.ts`, controllers/Search y los documentos de estado/contratos). Esta conclusión no realiza merge/cherry-pick. Mantener UAT humana, verificación UNC aprobada, preproducción y producción como gates independientes. No iniciar NEAR, semantic search, RAG, scraper, AI summaries ni adquisición dentro de esta continuidad.

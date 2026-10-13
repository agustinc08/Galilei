# Roadmap operativo — Buscador Jurídico Civil

## Sprint 14 — recuperación pública de jurisprudencia (2026-10-08)

| Fase | Estado | Evidencia / próximo insumo |
|---|---|---|
| Discovery | PASS WITH GAPS | 421 enlaces CSJN a tomos (349 números); sitemap CIJ no utilizable (host interno); Datos Abiertos sin coincidencias; TFN/CIJ sentencias disallow. Docs 146–154. |
| Adquisición | BLOCKED | 0 archivos completos. El ejecutor rechazó guardar PDF de muestra antes de ejecución. Se requiere vía local permitida; CIJ/TFN requieren canal institucional. |
| Clasificación / dedupe / ingesta | PARTIAL / BLOCKED | Helpers offline y 7 tests; sin PDF individual para reconciliar ni ingresar. Docs 152–156. |
| Sync | BLOCKED | No hay cursor de fuente verificable; no automatizar rutas con CAPTCHA o robots-disallow. Doc 157. |

**Siguiente acción basada en gaps:** habilitar una vía aprobada para adquirir los PDFs CSJN publicados y solicitar export/paquete institucional CIJ/TFN; después reconciliar el lote y ejecutar dry-run e ingesta DEV bajo guard. No volver a preproducción ni reauditar Search.

**Actualizado:** 2026-10-13 tras cierre técnico Sprint 14.9.2. No repetir auditorías cerradas salvo evidencia contradictoria.

**Estado vigente:** PHRASE continúa sobre el gate: p95 comparable 2.427,38 ms y early exit no certifica totalExact. Dominante medido: sort/agregado ordenado de 8.958 candidatos, ~402 ms inclusivos; experimentos de conteo completo tardaron 29,5–32,0 s. No avanzar a revisión de los 452 grupos ni a los 4.890 enlaces abiertos hasta cumplir p95 <=1.200 ms y exactitud del total. Detalle en BJC-SEARCH.md.

## Gate vigente — Sprint 14.9.2 (2026-10-13)

**Estado: PARTIAL / PHRASE REGRESSION REMAINS.** No se conservó una modificación del runtime. Se comprobó el coste del orden/agregado completo antes de la primera ventana y el coste prohibitivo de contar todos los textos vía ILIKE. El total exacto permanece pendiente cuando PHRASE sale temprano. Mantener la adquisición y los grupos de revisión sin cambios hasta que Search pase el gate de latencia y conteo exacto. Evidencia: _recovery-work/sprint1492/final-summary.json.

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

## Siguiente acción concreta

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

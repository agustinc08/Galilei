# Buscador Jurídico Civil — inicio rápido

**Actualizado:** 2026-10-09, Sprint 14.3. Empezar por `BJC-ADQUISICION-JURISPRUDENCIA.md` para adquisición, `BJC-SEARCH.md` para Search y `BJC-ESTADO-ACTUAL.md` para el estado general.

## Qué estamos construyendo

Una búsqueda jurídica civil sobre datos con procedencia, permisos y curaduría explícitos. Jurisprudencia y Digesto mantienen ownership, estados editoriales y ACL propios; Corpus proporciona archivo trazable, texto y navegación compartidos. Sprint 14 encontró 421 enlaces de tomos CSJN/349 números; no descargó PDFs. CIJ/TFN y API/history de Datos Abiertos tienen rutas disallow; ver docs 146–158.

## Código y entorno

- Raíz real: `C:\proyecto triple`; backend `JurisprudenciaN\back`; frontend `JurisprudenciaN\front`.
- Stack: NestJS/Prisma/PostgreSQL 16 y Next.js/React. PostgreSQL DEV: `127.0.0.1:55432`, base `buscador_juridico_civil_dev`, rol `bjc_dev`.
- Para operaciones DEV usar `JurisprudenciaN\back\scripts\with-dev-db-guard.cjs`. Nunca imprimir/secreto de `.env.development.local`.
- Roots institucionales de PDFs son sólo lectura. Mantener originales en su lugar; copias derivadas sólo en storage content-addressed.
- No acceder a producción ni a bases/servidores institucionales. Para la excepción TFN del flujo normal autorizado en Sprint 14.2 y sus límites, seguir `BJC-ADQUISICION-JURISPRUDENCIA.md`; CIJ mantiene las restricciones previas.

## Resultado actual

- **Sprint 13 — preproducción técnica BLOCKED / NOT EXECUTED; UAT PENDING.** No se identificó host separado autorizado ni DB/storage preprod. La ausencia de ambiente no es una falla funcional; DEV no se promovió como preprod. Ver docs 126–139.
- **Último gate de software verificado: Sprint 12.3 READY WITH NON-BLOCKING ADJUSTMENTS**, sólo para avanzar a preprod/UAT. Backend 86 PASS y 15 opt-in omitidos; PostgreSQL 7/7, Corpus 3/3, paquete 2/2; typecheck/build backend y frontend PASS; Playwright 5/5. Evidencia DEV doc 125, no smoke preprod.
- Guard DEV continúa apuntando exclusivamente a `bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev`; cualquier operación PostgreSQL DEV sigue detrás del guard.
- **Sprint 14 — PARTIAL / BLOCKED FOR ACQUISITION.** Corpus conocido: 10.732 documentos, 10.752 objetos, 23.829 ubicaciones, 95.486 páginas. Se descubrieron 421 enlaces de tomos, con 0 descargados/verificados y 0 documentos nuevos; búsquedas públicas de Datos Abiertos sin resultados para cinco términos; CIJ sitemap con host interno `cij7.test`; CIJ/TFN restringidos. Ver informe 158 y manifests no versionados en `_recovery-work/sprint14`.

- **Sprint 8 — GO CON AJUSTES.** 23.829 archivos físicos PDF-like, 10.732 SHA únicos, 13.097 duplicados físicos, 4.866.746.671 bytes. Manifest `1a063011-f3a3-421f-bd11-1ecdf3896bb2`, SHA-256 `4e0f484a1603e5d73787982f630af5006c3906a94323b17e5fa619f162ac0224`.
- Ingesta en DEV: 10.732 procesados, 10.727 documentos nuevos, 5 reutilizados, 0 fallidos. 10.332 indexados, 399 OCR_REQUIRED, 1 INVALID_PDF, 95.392 páginas. Segunda pasada: 0 nuevos, 10.732 reutilizados, conteos estables.
- Search y visor funcionan en el smoke real; consulta+snippet+match+archivo con checksum, visibilidad INTERNAL y salto a página. Índice de título bajó `EXPLAIN ANALYZE` de 3.613,8 ms a 0,333 ms; smoke 36 ms en DEV.
- Clasificación: 21.547 sugerencias por reglas, todas SUGGESTED; 8.667 documentos con sugerencia y 2.064 sin clasificar. No hay precisión semántica validada ni resultado AI.
- Asociación real: 0 EXACT/vinculados, 27 HIGH_CONFIDENCE y 2 CANDIDATE en revisión, 10.703 UNRESOLVED. Ninguna Sentencia duplicada/creada.
- Digesto permanece fuera de este corpus: sus 278 PDFs fueron excluidos, sin links reales a Digesto.
- Tests/build/typecheck pasan; ver informe 60. No es certificación productiva.

## Lectura de documentación

1. `BJC-ESTADO-ACTUAL.md`, `BJC-DECISIONES-Y-CONTRATOS.md`, `BJC-MAPA-TECNICO.md`.
2. `BJC-FUNCIONAL.md`, `BJC-FUENTES-DE-DATOS.md`, `BJC-ROADMAP.md`.
3. Sprint 8: `53-INVENTARIO-PDFS-INSTITUCIONALES.md` y `54`–`60`.
4. M7.1: informes 47–52. M7/CIJ/CSJN: 41–46. M5.3–5.4: 29–35. M6: 36–40.

## Reglas permanentes

- No modificar roots fuente de PDFs. No reescanear el universo completo sin motivo; usar el manifest/checkpoint.
- No convertir candidatos de asociación o clasificación en verdad automática. No publicar por haber importado.
- Si una fuente física desaparece en el futuro, registrar `sourceMissing` y requerir revisión; no eliminar automáticamente CorpusDocument.
- Ingesta real, migraciones y fixtures sólo en DEV guardado. CIJ/CSJN sólo con canal oficialmente autorizado.

## Siguiente trabajo

**Sprint 9 — workflow real de Jurisprudencia + Digesto + Curaduría:** revisar asociaciones, aprobar/rechazar temas, seleccionar con motivo, guardar responsable/historial, resolver permisos/anonimización y conectar colecciones Digesto. Mantener OCR como piloto separado y local para los 399 pendientes; añadir resaltado dentro del PDF y validación funcional con usuarios.

## Estado de cierre Sprint 10 (2026-10-08)

Sprint 10 supersede el estado anterior: **READY FOR PILOT CON AJUSTES**, sólo prueba guiada en DEV local. Leer `78-RESULTADO-SPRINT-10.md` y evidencia `71`–`78`. Digesto local: 278 PDFs físicos, 276 SHA únicos, 276 documentos únicos importados a Corpus como `DIGESTO_LOCAL`; no se encontró export de metadata, por lo que IDs, taxonomía y ACL legacy siguen pendientes. E2E autenticado para seis roles; browser smoke de LECTOR/Admin, highlight PDF.js y dashboard. Ground truth OCR no autoriza ampliar el lote. Sin aceptación institucional ni autorización de producción.

Plan anunciado al cierre de Sprint 10 (histórico): Sprint 11 — validación con usuarios, correcciones del piloto y preparación de preproducción, sin conexión a producción/servicios remotos. El estado vigente está en Sprint 12.1 más abajo.

## Estado Sprint 11 (2026-10-08)

Sprint 11 supersede el dictamen anterior: **NOT READY FOR PREPRODUCTION**. Search total p50 6,8–13,8 s y a concurrencia de 10/20 usuarios alcanza p95 37/65,7 s; restore temporal quedó bloqueado por App Control y `bjc_dev` carece de CREATEDB. UAT institucional PENDING HUMAN ACCEPTANCE; no representa rechazo humano. Leer `87-RESULTADO-SPRINT-11.md` y docs 79–86. Validación final: backend 70 pruebas generales, PostgreSQL E2E 2/2, Playwright 4/4, typecheck y builds PASS en DEV local. Mantener local y acompañado, corregir Search antes de red compartida y probar recuperación en host aprobado.

## Estado Sprint 12.1 (2026-10-08)

Sprint 12.1 mantiene **TECHNICAL PREPRODUCTION — NOT READY**. El corpus exacto de benchmark sigue lento (TERM común p50 6,26 s; PHRASE 7,68 s; Boolean complejo 14,77 s); Corpus canceló entre 50% y 100% de varias familias por `57014`. Con 10 usuarios Search p95 fue 45,57 s y registró 106 errores de fuente. Paridad del adaptador: 40/40. Backend 79 tests + opt-in PostgreSQL/Corpus PASS; frontend typecheck/build y Playwright 4/4 PASS. Restore real y migration-from-zero pasaron con verificaciones y cleanup de las dos DB temporales. DEV conserva 17 migraciones y status limpio. Leer docs 99–106; próximo trabajo acotado: reducir el costo de candidatos e hidratación Search preservando paridad y ranking, luego repetir benchmark y concurrencia.
## Estado de cierre Sprint 9 (2026-10-08)

Leer primero 70-RESULTADO-SPRINT-9.md y después informes 61–69. Implementada navegación unificada, curaduría auditable, taxonomía Digesto sobre documentos Corpus, scan incremental y OCR piloto. Resultado: NO GO integral; desarrollo local acotado sigue en DEV. La migración 14/14 está aplicada sólo en PostgreSQL local protegido. No conectar Digesto remoto ni crear enlaces institucionales sin export/crosswalk autorizado. No habilitar producción. Los detalles vigentes y bloqueos están en BJC-ESTADO-ACTUAL.md.

## Corte histórico — Sprint 12.2 (2026-10-08)

Sprint 12.2 implementó candidate sets V2, late hydration y la proyección tokenizada Corpus. Paridad: 40/40 más 11/11 semánticos PASS; build backend/frontend y Playwright 4/4 PASS. PostgreSQL DEV tiene 20 migraciones limpias; la proyección verificó 11.008 documentos/9.475.712 tokens, cero stale. El dictamen sigue **TECHNICAL PREPRODUCTION — NOT READY**: el endpoint visible aún tarda p50 5,9–7,4 s para TERM/PHRASE y la carga de 10 usuarios p95 fue 35,6 s con 11 errores HTTP. Leer docs 107–116, sobre todo 112, 113, 115 y 116. Próximo alcance técnico: integrar el camino V2 con el contrato legacy visible y resolver rechecks Corpus de PHRASE/PREFIX/SUFFIX/SHORT. No se habilita red compartida; HUMAN ACCEPTANCE/ACL/export Digesto siguen PENDING y CIJ/CSJN NO GO.

## Estado vigente — Sprint 12.3 (2026-10-08)

El endpoint estándar `/api/busqueda/avanzada` ahora atiende con V2 en las 15 familias medidas (`legacyMs=0`); paridad 40/40, endpoint Playwright, PHRASE/PREFIX/SUFFIX/SHORT funcionales y concurrencia 1/5/10/20 sin errores tras elevar el pool Corpus a 8. Dictamen técnico: **READY WITH NON-BLOCKING ADJUSTMENTS** para preproducción controlada/UAT; no es autorización de producción o red compartida. Restore y DB vacía continúan PASS histórico de docs 103/104; Sprint 12.2 sumó schema replay. Leer docs 117–125. HUMAN ACCEPTANCE, ACL y export Digesto siguen PENDING; CIJ/CSJN automatizado NO GO. Siguiente paso: Sprint 13 preproducción controlada y UAT institucional.

## Cierre Sprint 13 — 2026-10-08

La Sprint 13 preparó docs 126–139 pero no identificó host institucional preprod: **technical preprod BLOCKED / NOT EXECUTED**; **UAT institucional PENDING**; ACL, anonimización y retención **PENDING**; Digesto export **PENDING**. No hubo deploy, migración, importación, smoke ni medición preprod. El último gate técnico de software sigue siendo Sprint 12.3 en DEV; no es autorización de producción/red compartida. Ver `139-RESULTADO-SPRINT-13.md`.

## Cierre Sprint 13.1 — 2026-10-08

Paquete compacto de bootstrap entregado en docs 140–145: solicitud a SYTEC, UAT, hoja ACL, checklist, deploy automatizado condicionado y resultado. Se agregaron guardas preprod de lectura/proyección, rechazo loopback, smoke Playwright HTTPS parametrizado y referencia de variables sin secretos. No existe aún destino preprod: **BLOCKED / NOT EXECUTED**; no hubo migración, importación, deploy, carga ni UAT. Siguiente acción externa: infraestructura debe completar doc 140 y proveer host/DB/storage/proxy/TLS/backup/vault autorizados; owners institucionales deben decidir ACL, retención, corpus y participantes. Ver `145-RESULTADO-SPRINT-13.1.md`.


## Sprint 14.2 — estado vigente

El Sprint 14.2 completó el inventario global de 226.770 resultados en 11.339 páginas. Detectó 1.277 fallos de Cámara Civil; 1.254 documentos nuevos quedaron en Corpus/Search V2 y un PDF conserva HTTP 404. El buscador actual ofrece 110 Juzgados Civiles y 14 Salas, pero la consulta requiere intervención humana ante `cap-widget`. Para cobertura, límites y comandos vigentes, leer `BJC-ADQUISICION-JURISPRUDENCIA.md` y `BJC-SEARCH.md`.

## Estado vigente — Sprint 14.3

Feed reciente CSJN: una sentencia Civil de primera instancia capturada y verificada end-to-end (Juzgado Civil 64, 2026-10-08). Corpus Civil: 1.254 documentos de Cámara y 1 de Juzgado; Search Projection lista con 12.263 documentos, 10.038.148 tokens y cero stale. El sync sigue parcial por ventana limitada de 20 resultados; el backfill filtrado 2013→hoy requiere intervención humana ante `cap-widget`. CIJ conserva leads sin match/descarga. Leer el detalle y gaps en `BJC-ADQUISICION-JURISPRUDENCIA.md`.

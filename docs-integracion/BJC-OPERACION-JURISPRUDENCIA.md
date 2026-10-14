# Operación de Jurisprudencia — Sprint J9

**Fecha:** 2026-10-14 · **Estado:** `J9_CLOSED_IN_DEV` · **Rama:** `feature/jurisprudencia`

## Propósito

Jurisprudencia es la consulta institucional de fallos publicados. La entrada `/jurisprudencia` conduce directamente a la búsqueda `/consulta`. Los documentos privados de Sala/Juzgado y personales pertenecen a Mi espacio y conservan sus permisos propios.

## Roles

- Consulta/lector: buscar, filtrar, abrir y descargar fallos publicados. No puede modificar ni publicar.
- `JURISPRUDENCIA`, `OPERADOR` y `ADMIN`: pueden crear borradores, cargar PDFs, editar metadata, publicar mediante acción explícita y archivar con auditoría.
- El rol de Jurisprudencia no agrega membresía ni acceso a espacios privados.

La autorización se aplica en backend. Las rutas normales de creación fuerzan `BORRADOR`; editar metadata no permite cambiar `publicado`, `activo` ni `estadoCarga`. Publicar, retirar y archivar son acciones explícitas. Los PDFs se conservan; archivar retira el fallo de consulta y conserva procedencia.

## Carga manual

`+ Nuevo fallo` empieza por el PDF. Se valida MIME, extensión, tamaño (hasta 100 MB), firma `%PDF-`, SHA-256 y lectura estructural. El SHA repetido devuelve conflicto con enlace al fallo existente cuando está vinculado. El contenido nuevo usa el pipeline Corpus y almacenamiento content-addressed; el archivo se mantiene `INTERNAL` mientras el fallo está en borrador. No se genera reseña con IA.

La carga crea un borrador y su asociación exacta Corpus↔Sentencia. La pantalla de detalle permite completar expediente, carátula, Sala, fecha, tipo, Juez, magistrados, tribunal y sumarios. “Juez” es un campo opcional independiente de “Magistrados”. Los PDFs sin texto reconocible se aceptan y se muestran como tales; no se finge OCR.

## Publicación y archivo

Estados activos implementados:

| Estado | Sentencia | Corpus GENERAL |
|---|---|---|
| Borrador | `publicado=false`, `activo=true`, `BORRADOR` | `INTERNAL` |
| Publicado | `publicado=true`, `activo=true`, `PUBLICADA`, `publishedAt` | `PUBLIC` |
| Archivado | `publicado=false`, `activo=false`, `ARCHIVADA` | `INTERNAL` |

La transición pública tiene confirmación y escribe `AccionLog`. Los cambios de metadata se auditan. Se conserva `publishedAt` para ordenar los últimos incorporados. La búsqueda pública sólo incluye fallos activos y publicados; existe endpoint de últimos 10 publicados.

No se agregó una etapa obligatoria `IN_REVIEW`: el sistema actual permite que el operador complete la revisión y publique. La decisión puede revisarse si aparece una exigencia de separación de funciones.

## Paridad legacy y consulta

La consulta mantiene tema/texto, Sala, fechas, tipo y expediente visibles; los filtros restantes quedan bajo “Más filtros”. La paginación real y los filtros siguen en la URL, se quitó el aviso artificial de 300 resultados y el visor vuelve al conjunto de resultados. El detalle conserva impresión/descarga y muestra “Sin Sala informada” en lugar de valores técnicos.

`Nº sentencia` conserva su significado legal/legacy y nunca se confunde con el id de base. `Nº expediente` conserva su propio campo. La búsqueda global incluye Juez; no hay filtro exacto separado para Juez. Los posibles duplicados legales se advierten por expediente/Sala/fecha o número de sentencia; no se bloquean ni fusionan automáticamente.

## Publicación legacy y auditoría ACL — J9.0.1

La auditoría pre-write reconstruyó exactamente el manifest J8 de 6.070/6.070 IDs y archivos, con SHA/provenance íntegros, las tres fuentes institucionales esperadas y 0 asociaciones a workspaces o asociaciones privadas. Ningún archivo, página, texto, provenance, Search projection ni visibilidad Corpus fue cambiado por el backfill. No se asignaron fechas ficticias ni autores humanos.

Se publicaron 6.014 fallos mediante filas de workflow `Sentencia` y enlaces existentes/creados con provenance `LEGACY_JURISPRUDENCE_PUBLICATION_BACKFILL`. La consulta pública expone sólo filas activas/publicadas, con búsqueda y visor protegidos por el vínculo exacto. Los documentos Corpus permanecen `INTERNAL`; no se abrió el acceso general a Corpus ni se cambió su ACL. Se conservaron 56 casos para revisión (colisiones de identidad legal y archivos TXT/modelo); los 36 registros afectados por colisiones quedaron como borradores/inactivos y sus documentos fuente se preservaron. La reejecución dry-run indicó `wouldCreate=0`.

Prueba ACL: `PUBLICATION_SAFE=6014`, revisión/ambigüedad=56, `PRIVATE_CONFLICT=0`, `WORKSPACE_CONFLICT=0`, `ARCHIVED_CONFLICT=0`, `UNKNOWN=0`. La tabla `WorkspaceDocument` y asociaciones privadas no recibieron escrituras. La prueba de regresión de espacios privados pasó.

## Seguridad y límites

- El lector no puede cargar, editar, publicar ni archivar; la UI no sustituye guards.
- La publicación nueva sólo propaga visibilidad a documentos `GENERAL` vinculados a esa sentencia. El backfill legacy J9.0.1 deja Corpus `INTERNAL` y sirve el conjunto aprobado por la ruta pública de Sentencia.
- Los archivos son inmutables y content-addressed. El endpoint de borrado de archivo no elimina el original.
- No hay scraper, descargas externas, OCR nuevo ni resumen AI.
- No se reconstruyó Search ni se hizo reindex masivo.

## Validación y decisión

La ruta Playwright cubrió búsqueda real, filtros/paginación, rechazo de PDF inválido y el ciclo de PDF válido desde operador: borrador invisible, publicación visible, detalle, Viewer, descarga, edición, archivo que retira visibilidad y rechazo de mismo SHA. La regresión de roles niega al lector crear, editar, publicar, archivar, borrar o cargar. Responsive pasó a 375/768/1366 px. Suite backend: 98 PASS/17 omitidos en 21 suites; test PostgreSQL J9 1/1 PASS; ACL PostgreSQL 1/1 PASS; Prisma generate/validate y 24/24 migraciones PASS; builds backend/frontend, typecheck y lint enfocado PASS. J8 continúa `CERTIFIED_WITH_KNOWN_GAPS`: 6.070/6.070, `BROKEN=0`, `UNKNOWN=0`, `UNRESOLVED=0`, integridad y provenance 100%.

Performance loopback (10 muestras tras warmup): broad 6.014 resultados p50/p95 72.93/83.91 ms; Sala H 366 resultados 382.49/395.19 ms; expediente exacto 339.09/364.13 ms; carátula 305.99/337.04 ms; año 2022 289.15/335.29 ms. Consulta media `responsabilidad civil` p50 8.353 ms/p95 10.507 ms (`totalExact=false`), marcada para el sprint final de Search. No se forzó un cambio de motor sin prueba de paridad.

**Dictamen:** J9 queda `CLOSED` en DEV: el lector tiene un corpus institucional sustancial, reconciliado y sin exposición privada, y el flujo PDF completo se probó desde navegador. Los 56 casos de revisión y el costo de la búsqueda media permanecen explícitos. Esto no habilita producción, preproducción ni red compartida. Evidencia local/ignorada: `_recovery-work/jurisprudencia-j901/`.

## Adenda J9.1 — UX lector/operador (2026-10-14)

La capa de presentación facilita la consulta y el ciclo existente; no cambia contratos de publicación, API, roles, Search o ACL. Las rutas E2E lector/operador y cleanup sintético de J9.0.1 siguen como evidencia del workflow. En el corte DEV, sumarios visibles=0 y activos no publicados=21.119; no equiparar esta lista histórica con los 56 pendientes del manifiesto J8/J9.0.1. Viewer visual queda pendiente de comprobación con PDF cargado. UAT no ejecutada. Detalles: `BJC-UX-JURISPRUDENCIA.md` y evidencia local ignorada `_recovery-work/jurisprudencia-j91/`.


## Sprint J9.1.1 — cierre dirigido UX (2026-10-14)

- Sumarios reales reader-visible en los 6.014 publicados: 0. Los 25.138 sumarios legacy están vinculados a filas legacy sin cruce demostrado hacia los nuevos fallos del Corpus. El flujo `Ver sumario` y el filtro `numeroSumario` siguen soportando datos cuando existen; E2E sintético mostró dos sumarios (900001/900002) y sus temas.
- La cola de operador contiene exactamente 56 documentos, derivados del estado persistido (36 colisiones legales) más fuente/archivo `text/plain` (20); no se hardcodearon IDs ni el número en frontend. Los demás activos no publicados se listan aparte: 21.083 tras excluir las 36 sentencias con marca de revisión. El lector recibe 403. Ningún caso de revisión se publicó.
- El contador publicado antes/después es 6.014. El total activo no publicado sin la cola es 21.083; los 20 documentos `text/plain` no tenían fila `Sentencia` y por eso no forman parte de las 21.119 sentencias activas no publicadas.
- Viewer E2E comprobó firma, parser, dimensiones y capturas visuales de PDF real/sintético. La causa de la captura vacía previa fue el momento temprano de captura; Viewer core/wrapper y Search permanecen sin cambios.
- Print usa localStorage + `/consulta/imprimir` + `window.print()` y stylesheet `@media print`; el smoke de la vista pasó. El diálogo del SO/navegador no se automatiza.
- Fixture de borde: carátula 433 chars, sumario 4.397 chars, 12 magistrados, 12 temas, overflow 0 a 1366/1920.

E2E J9.1.1: 3/3 PASS; workflow PostgreSQL: 1 integración + 4 unitarias PASS; frontend build/typecheck/lint dirigido y backend build/lint dirigido PASS. `prisma validate/generate` PASS; 24 migraciones al día. `tsc --noEmit` backend aún señala tres errores previos en `sentencias.workflow.spec.ts` (tipos de callbacks jest); no se originan en J9.1.1. UAT y producción siguen fuera de este cierre. Evidencia local ignorada: `_recovery-work/jurisprudencia-j911/`.


# Operación de Jurisprudencia — Sprint J9

**Fecha:** 2026-10-14 · **Estado:** `PARTIAL_IMPLEMENTED_ACL_PUBLICATION_BLOCKER` · **Rama:** `feature/jurisprudencia`

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

## Estado del corpus certificado y bloqueo

La auditoría de solo lectura del 2026-10-14 registró: 21.109 filas `Sentencia`, 0 publicadas y 0 sumarios visibles; 17.078 documentos Corpus, 0 `PUBLIC`; 6.070 documentos Civil certificados por J8, todos actualmente `INTERNAL`, y 0 vínculos `JURISPRUDENCIA/SENTENCIA`.

No se hizo backfill ni se cambió visibilidad. Publicar en bloque documentos importados contradiría la política vigente de ACL y curaduría explícita. Por eso J9 **no puede declarar cumplido el requisito de que los 6.070 sean visibles a lectores** hasta que exista decisión de publicación/ACL y asociación aprobada. El buscador no debe presentar el corpus interno como público. Evidencia reproducible local/ignorada: `_recovery-work/jurisprudencia-j9/database-audit.json`.

## Seguridad y límites

- El lector no puede cargar, editar, publicar ni archivar; la UI no sustituye guards.
- La visibilidad de publicación sólo se propaga a `documentScope=GENERAL`; no toca documentos privados.
- Los archivos son inmutables y content-addressed. El endpoint de borrado de archivo no elimina el original.
- No hay scraper, descargas externas, OCR nuevo ni resumen AI.
- No se reconstruyó Search ni se hizo reindex masivo.

## Validación

Después de aplicar la migración aditiva `20261013160000_sprint_j9_jurisprudence_workflow`, J8 volvió a `CERTIFIED_WITH_KNOWN_GAPS` (6.070/6.070, 0 BROKEN/UNKNOWN). Suite backend: 97 PASS, 16 omitidos; prueba PostgreSQL J9 sintética: 1/1 PASS y cleanup sin residuos; build backend, typecheck y build frontend: PASS. Playwright/UAT de navegador no se ejecutó; queda pendiente junto con la autorización ACL/publicación del corpus certificado.

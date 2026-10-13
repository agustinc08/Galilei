# Funcional — Jurisprudencia, Digesto y Copernic

**Base:** decisiones y entrevistas consolidadas en informes 01–16, 21–22 y especificación de esta misión. Separar contexto funcional de funciones implementadas.

## Jurisprudencia y curaduría

Las Salas protocolizan resoluciones mediante Lex100. Secretaría de Jurisprudencia selecciona casos novedosos, aislados, cambios de criterio, contradicciones, cuestiones jurídicamente relevantes o criterios históricos que se reactivan. El corpus actual se apoya principalmente en segunda instancia; el sistema debe contemplar primera instancia.

Un documento obtenido no pasa automáticamente al corpus: recepción, selección, publicación y acceso público son decisiones/estados separados. Conservar fuente, órgano, instancia, fecha, identificador externo y procedencia. Curaduría debe registrar responsable, fecha, motivo e historial.

## Acceso y privacidad

Estado editorial, ACL/visibilidad y anonimización son dimensiones independientes. Un documento seleccionado no se vuelve público automáticamente. Autorización debe aplicarse antes de conteos, ranking, snippets, facetas, preview y descarga.

## Búsqueda general y Copernic

Requisito de producto: **Todo documento autorizado almacenado en el repositorio institucional debe poder ser encontrado por su contenido, leído y navegado rápidamente.**

Flujo futuro: consulta → resultados/snippet → documento → coincidencia → anterior/siguiente → buscar dentro del documento. Requiere extracción/indexación de texto, permisos, versiones, enlaces seguros y medición. No reducir Copernic a AND/OR ni equiparar esta visión con una funcionalidad ya implementada.

## Digesto

Debe organizar documentos mediante colecciones, temas, etiquetas y filtros, permitir búsqueda dentro del contenido y refinamiento. Carpetas sólo si un flujo validado las necesita. La IA futura podrá sugerir clasificación; una persona autorizada debe aprobarla. Digesto mantiene modelo y permisos propios aunque comparta UX o read model.

## Estado de implementación tras Sprint 8

- **IMPLEMENTADO Y CARGADO EN DEV:** 10.732 documentos locales por SHA; 10.332 tienen texto y páginas indexadas; 399 requieren OCR y uno es inválido. Los originales quedan en roots read-only.
- **IMPLEMENTADO:** Parser/AST, adapters SQLite/PostgreSQL y fan-out aditivo Jurisprudencia+Corpus; smoke institucional real probó snippet, match/página, ACL interna y descarga con checksum.
- **IMPLEMENTADO EN UI:** búsqueda avanzada con resultados Corpus; panel administrativo de resumen/cola y viewer con PDF nativo, procedencia/metadata, búsqueda dentro del documento, contexto y anterior/siguiente, descarga autenticada.
- **IMPLEMENTADO:** reglas locales sugieren temas con evidencia/confianza; las 21.547 sugerencias quedan SUGGESTED. No hay IA, aprobaciones ni selección editorial automática.
- **PENDIENTE SPRINT 9:** revisión/aprobación/rechazo humana de asociaciones/clasificación, selección jurisprudencial con motivo e historial, acciones seguras por lote, Digesto real Collections/Topics/Tags y crosswalk ACL.
- **PENDIENTE:** resaltado pintado en la capa del PDF, OCR controlado, scan incremental/sourceMissing, evaluación semántica con ground truth aprobado, SLO/carga y política institucional de anonimización/publicación.
- **NO GO:** scraping/descarga CIJ/CSJN de rutas disallow, Lex100 y producción sin mecanismo/autorización institucional.

## Estado funcional al cierre de Sprint 9

IMPLEMENTADO EN DEV: navegación unificada, relaciones Digesto a Corpus, cola de revisión, aprobación/rechazo auditable de sugerencias, selección editorial con motivo, muestra OCR e inventario incremental. Sin aprobación automática. Clasificación y asociaciones reales permanecen pendientes de operador. Digesto legacy continúa fuera del corpus unificado por falta de export/crosswalk ACL. El visor no dibuja resaltado PDF; tampoco se probó E2E autenticado. Sprint 9 NO GO integral/producción. Ver informes 62–70.

## Estado funcional Sprint 10

PDF.js con text layer, highlight de coincidencia activa/restantes, búsqueda dentro y navegación probado en browser; snippet lateral es fallback. Search avanzada filtra por colección Digesto. Los 276 PDFs únicos locales ya viven en Corpus y tienen relaciones Digesto con colección marcador. Se probaron roles y flujos backend autenticados: revisión de clasificación, selección Jurisprudencia con motivo/historial y membership Digesto. Dashboard consulta conteos reales y drill-down; incremental separa cuatro deltas en fixtures.

Límites: sin metadata legacy autorizada ni aceptación institucional; OCR no se amplía; batch sólo clasificación; sin undo genérico; sesión/rate limit/observabilidad compartida pendientes. Ver docs 71–78.

## Estado funcional Sprint 11

E2E automatizado confirma seis roles por API; Playwright 4/4 valida recorrido LECTOR con búsqueda/filtro, PDF/highlight/procedencia, ADMIN dashboard/logout y navegación REVISOR/JURISPRUDENCIA/DIGESTO. No sustituye UAT real: Secretaría/Jurisprudencia, Digesto, Consulta y Administración deben registrar PASS/FAIL/OBSERVACIÓN/SUGERENCIA en doc 79. La matriz ACL doc 81 sigue propuesta.

Batch membership Digesto y envío a revisión Jurisprudencia ahora tienen preview y respuesta por documento; undo auditado devuelve clasificación a SUGGESTED con motivo. La membresía de colección conserva documento/archivo. Health readiness verifica DB/storage, los errores 5xx se ocultan tras requestId, rate limit y JWT expiry son configurables.

Viewer Range 206 se probó en PDF de 1, 50 y 109 páginas; máxima muestra 167 páginas/11,35 MiB y el cliente react-pdf renderiza la página solicitada. El servidor aún lee/verifica el archivo completo antes de responder y la UI descarga un Blob completo; tamaño máximo local observado es acotado, pero streaming requiere revisión si aumenta.

Límites de Sprint 11: búsqueda end-to-end p50 6,8–13,8 s y carga 10/20 usuarios p95 hasta 37/65,7 s; no habilitar red compartida. OCR PSM4 en dos outliers aún requiere revisión visual; no cambia contenido indexado. Ver resultado integral 87.

## Actualización Sprint 12 — filtros de búsqueda

La búsqueda avanzada permite filtrar por colección, tema y etiqueta de Digesto local mediante IDs. Al activar esos filtros, la consulta se acota al Corpus y evita el fan-out legacy de Jurisprudencia. La búsqueda conserva el total exacto y paginación actuales. El catálogo local no tiene asociaciones activas suficientes para medir topic/tag; UAT y metadata de Digesto siguen pendientes. Ver informe 88.

## Gate de uso Sprint 13

El flujo de producto conserva el resultado técnico Sprint 12.3 en DEV, pero no hubo UAT institucional en esta Sprint: aceptación por Lector, Jurisprudencia, Digesto, Revisor e IT/Admin sigue PENDING. El manual 135 es borrador anterior a UAT. Ninguna sugerencia, membresía o selección editorial concede publicación/visibilidad. Matrices ACL, anonimización y retención están pendientes de los owners institucionales (docs 129–131). No existe despliegue compartido.

## Mi espacio — Sprint 15

Usuarios autenticados ven los espacios donde tienen membresía activa. ADMIN del workspace gestiona miembros; ADMIN/EDITOR organizan carpetas y suben hasta 20 PDFs por operación (20 MB cada uno); VIEWER busca y lee. Documentos recientes muestran estado y páginas. La búsqueda por texto devuelve total del espacio autorizado, snippet y acceso al viewer con página/resaltado. OCR_REQUIRED permite abrir el PDF y no produce resultados de texto. La UX de administración avanzada, cuotas, soft-delete y versionado queda pendiente. Detalle: `BJC-ESPACIOS-DOCUMENTALES.md`.

## Sprint 15.1 — UAT técnico y UX

La home privada comunica dependencia, rol y alcance; simplifica la entrada de usuario con un solo espacio y ofrece selector a usuarios multi-espacio. La raíz y breadcrumbs ubican al usuario. Search privado incluye filtro de carpeta y coincidencia por nombre, y los resultados conducen al viewer protegido. Carga por selector/drag-and-drop gestiona hasta 20 PDFs con errores y duplicados por archivo. Admin de espacio opera membresías, roles, carpetas y actividad; Admin Galilei gestiona disponibilidad de workspaces sin heredar acceso documental.

Playwright y las pruebas PostgreSQL sintéticas pasaron para Admin global/workspace, Editor, Viewer, multi-workspace, sin workspace y aislamiento A/B; includes descarga/viewer cruzado 404 y universo general separado. Responsive smoke capturó home a 1366×768 y 1920×1080. Esto no reemplaza UAT real: falta aceptación de usuarios/owners de dependencias y el estado Sprint 15.1 permanece PARTIAL. PHRASE a 500/1.000 documentos sigue parcial con ventana 100 y total no exacto; no se modificó el motor. Ver matriz, límites y rendimiento en `BJC-ESPACIOS-DOCUMENTALES.md`.

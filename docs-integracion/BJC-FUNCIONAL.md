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
## Sprint 15.3 — Classic Search y preview persistente

/spaces pasa a la experiencia de búsqueda de tres paneles: árbol de espacios/carpetas/fuentes, búsqueda y resultados compactos, y preview PDF persistente. La administración de workspaces y miembros sigue en /spaces/manage. Seleccionar un resultado actualiza el panel sin navegar; Abrir completo conserva el workspace, query, fuente/carpeta, página y coincidencia para volver al mismo contexto.

Search admite alcance por workspace, carpeta Galilei, fuente y carpeta virtual de fuente; combina coincidencias por contenido y nombre, y marca cuando el total es parcial. Upload y fuentes quedan distinguidos en el árbol. No se activan refinamientos de tipo o fecha hasta contar con filtros backend. Ctrl+F, flechas, Enter, Escape, F3 y Shift+F3 cubren el recorrido de teclado principal.

La UI reutiliza CorpusPdfViewer y endpoints privados con ACL; la suite autenticada comprobó lectura/descarga como VIEWER y 404 al solicitar un documento del workspace ajeno. La muestra PDF resaltó TERM y navegó a la página relevante. La correspondencia exacta de offsets para resaltado PHRASE continúa pendiente; el motor, parser y ranking no cambiaron. UAT real sigue PENDING. Estado de sprint: PARTIAL; evidencia y límites en BJC-ESPACIOS-DOCUMENTALES.md.

## Sprint 15.3.1 — filtros y coincidencias

Copernic manda filtros de tipo PDF/TXT y fecha desde/hasta al backend junto con el workspace/source/folder; nombres y contenido usan conteo y paginación filtrados en SQL. La fecha jurídica se toma de `decisionDate`, sin fallback; el tipo sale del MIME de la última versión. `/matches` señala spans TERM/PHRASE en el texto extraído original, con offsets UTF-16 por página. El viewer usa esos límites para texto y PDF.js, conserva la frase a través de whitespace normalizado y falla sin highlight si la página del PDF no ofrece una correspondencia determinista. La carga manual acepta texto TXT; los scanners permanecen PDF. El resultado técnico es PARTIAL por la alineación entre extractores aún no demostrada para todo el universo. Ver el contrato y evidencias en `BJC-SEARCH.md` y `BJC-ESPACIOS-DOCUMENTALES.md`.

## Sprint 15.3.2 — preview y resaltado en PDF real

Search sigue entregando el span exacto de la página extraída. PDF.js se mapea por item/local offset; cuando texto, contexto y ordinal no señalan un lugar único, la coincidencia permanece navegable por página y snippet, con un aviso `role=status` y sin marca visual. La prueba detectó y corrigió la carrera en que el text layer terminaba antes de Search: el mapa de PDF.js ahora se conserva y se recalcula al llegar los spans.

Una muestra real de 25 PDFs/827 páginas produjo 138 mappings seguros y cero falsos; 83 spans no pudieron ubicarse de forma confiable, sobre todo en TERM/PHRASE con diferencias de whitespace y saltos de línea. El estado es PARTIAL: la UI demuestra un highlight real visible y fallback seguro, pero no promete mapping para todo PDF jurídico. Evidencia y capturas locales ignoradas en `_recovery-work/sprint1532/`; sin cambio de contrato Search ni ACL.

## Sprint 15.3.3 — cobertura de texto PDF.js

En la muestra base real, el Viewer ubicó 221/221 spans auditados sin falsos highlights; TERM 25/25 y PHRASE 18/18 quedaron visibles. Diez recuperaciones de baseline se revisaron en navegador con resize y carrera de requests. El mapeo requiere misma secuencia de glifos no blancos, preserva puntuación y distingue `ñ`; separadores entre items necesitan evidencia de fin de línea o geometría. Ambigüedad o falta de capa mantiene fallback sin marca. La certificación cubre las muestras y clases observadas, no PDF/OCR arbitrarios; aceptación de usuarios sigue PENDING.

## Sprint 15.4A — formatos y límites

La carga privada ofrece PDF/TXT/RTF/DOC/DOCX/ODT; TXT, RTF, DOCX y ODT muestran preview textual y permiten descargar el original con ACL. El tipo se detecta con contenido/paquete y no sólo con MIME del navegador. DOC se detecta y rechaza con mensaje explícito. En PDF, texto nativo continúa disponible aunque algunas páginas se marquen `OCR_REQUIRED`; OCR local no está instalado y no se ejecuta. No se habilitaron formatos P1. Estado **PARTIAL**, pruebas y detalles en `BJC-PROCESAMIENTO-DOCUMENTAL.md`.
## Procesamiento documental — Sprint 15.4A.1 (2026-10-14)

Galilei acepta PDF nativo, PDF escaneado e híbrido, TXT, RTF, DOC, DOCX y ODT. Para PDF, conserva el texto nativo y envía sólo páginas con menos de 25 caracteres al worker OCR local. La interfaz informa “Reconociendo texto…”; al terminar, Search puede encontrar texto OCR y el Viewer abre el documento/página y presenta contexto. En páginas OCR no se muestra un highlight visual no certificado.

DOC OLE válido se convierte a TXT con LibreOffice headless aislado; archivos inválidos, cifrados, con marcadores de macros u objetos embebidos, o que exceden timeout/límites se rechazan con estado diagnóstico. Ningún formato requiere cloud ni Word COM. ACL de workspaces y permisos de descarga continúan aplicándose antes de exponer texto o archivo. El cierre técnico es DEV local, no aceptación institucional.
## Sprint 15.5 — cierre Search + Viewer

Search general y privado pasaron la golden suite, paginación, filtros ACL y navegación UI. El submit de búsqueda Copernic ahora sincroniza query/filtros con la History API integrada en Next para que la inicialización concurrente del workspace no pierda la consulta. El Viewer mantiene PDF highlight fail-closed y OCR sólo con contexto/página, sin geometría inferida.

La E2E privada pasó 2/2 para OCR, RTF/DOC preview/descarga, F3, filtros, roles y denegación cruzada. Dictamen DEV: CERTIFIED_WITH_KNOWN_LIMITATIONS; no equivale a UAT humana, preproducción o producción. Ver `BJC-CERTIFICACION-SEARCH-VIEWER.md`.

## UX de documentos por dependencia — Sprint 15.6

En `/spaces`, una sola dependencia abre directamente; varias requieren elegir por nombre antes de entrar. El encabezado mantiene Sala/Juzgado/Secretaría activo. Búsqueda y árbol expresan alcance humano, los nombres de fuentes de red no revelan UNC, y el uploader autorizado informa destino y acceso compartido antes de seleccionar/confirmar la carga. Estados OCR se presentan como «Procesando documento…», «No pudimos extraer el texto de este archivo» y «Texto reconocido automáticamente».

La evidencia UI/E2E cubre miembro, edición/carga autorizada, rol lector, entrada única/múltiple, carpetas y navegación, búsqueda, preview, descarga, F3, mensajes de denegación, y responsive. No existe hoy en backend el ámbito «sólo yo» ni autorización por carpeta para un subconjunto de personas; no afirmar ni simular estas funciones. Dictamen de la experiencia completa: PARTIAL y UAT humana pendiente. Contrato y tareas humanas: `BJC-UX-ESPACIOS-DOCUMENTALES.md`.

## Documentos personales y carpetas restringidas — Sprint 15.6.1

`/personal` crea carpetas y asociaciones documentales privadas de la persona autenticada. Puede subir, listar, buscar, previsualizar, obtener coincidencias y descargar dentro de su ámbito. Compartir con una dependencia requiere membership activa y rol de carga/gestión (ADMIN/EDITOR), y una confirmación que informa a quién habilita. El documento deja de aparecer en Search personal cuando se publica en la dependencia. En `Mis documentos` se puede verificar el cambio de alcance para los archivos administrados elegibles.

En `/spaces/manage`, una carpeta puede ser compartida con toda la dependencia o restringida a integrantes activos seleccionados. El selector de integrantes consulta sólo membresías de esa dependencia. Al revocar una persona, Search deja de devolver el documento y metadata, matches y archivo entregan 404 de inmediato. Los hijos heredan los permisos de sus ancestros; no se puede crear un hijo compartido dentro de una carpeta restringida para ampliar alcance sin cambiar primero la carpeta superior. Mover entre alcances pide confirmación explícita. El creador de la carpeta y ADMIN conservan acceso a una carpeta restringida.

La certificación automatizada de Sprint 15.6.1 pasó integración ACL/PostgreSQL, E2E Playwright y siete tamaños responsive sin overflow. También pasó Search golden 319/319, Source PostgreSQL 2/2, seis corridas Workspace consecutivas después de aislar su cola OCR, Prisma con 27 migraciones aplicadas y Search Verify con el baseline intacto. No es UAT humana ni habilita fuentes de red, preproducción o producción.

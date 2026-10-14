# Procesamiento documental multiformato — Sprint 15.4A

**Corte:** 2026-10-14 · `feature/copernic` · estado: **PARTIAL**.

Este documento describe lo implementado en DEV para detección segura y extracción local. No acredita OCR, aceptación institucional ni preparación para producción.

## Matriz P0

| Formato | Detección | Extracción | OCR | Search | Preview/descarga | Límite actual |
|---|---|---|---|---|---|---|
| PDF con capa de texto | firma PDF | `pdf-parse`, por página | No necesita | Sí | Viewer PDF protegido | El mapping PDF.js conserva los límites certificados en Sprint 15.3.3; no es universal. |
| PDF escaneado / página de texto escaso | firma PDF y heurística por página | conserva cualquier texto nativo disponible | **No ejecutado**; marca páginas candidatas y estado `OCR_REQUIRED` | Sí para el texto nativo extraído | Viewer PDF protegido | Sin motor, modelo lingüístico ni worker OCR instalado. No se inventa texto OCR. |
| TXT | bytes/UTF-8 o UTF-16 compatibles con extensión | texto normalizado | No | Sí | preview textual y original protegido | Entrada máxima de 20 MiB. |
| RTF | estructura RTF, no MIME declarado | parser local que respeta grupos, Unicode, párrafos y tablas; omite objetos incrustados | No | Sí | preview textual con marcas exactas; descarga del original | Entrada máxima de 20 MiB. |
| DOC | firma OLE compound document | **No disponible** | No | No | No se incorpora por upload manual | Detección explícita y error `LEGACY_DOC_UNSUPPORTED`; no se intenta ejecutar ni convertir con Office. |
| DOCX | paquete ZIP y tipo principal OOXML validados | XML acotado, texto, párrafos y tablas | No | Sí | preview textual y descarga del original | ZIP limitado y validado; macros/rels externos no se ejecutan ni se siguen. |
| ODT | paquete ZIP, `mimetype` y `content.xml` validados | XML acotado, texto, párrafos y tablas | No | Sí | preview textual y descarga del original | ZIP limitado y validado; contenido externo no se consulta. |

Los MIME recibidos del cliente no determinan el formato. Se detecta por firma y estructura del contenido; el MIME canónico se persiste. La extensión se utiliza como señal auxiliar para texto plano y se conserva en la provenance. Source Sync reconoce `.pdf`, `.txt`, `.rtf`, `.doc`, `.docx` y `.odt`; un `.doc` legado se registra como no procesable, no como documento indexado.

## Límites de seguridad y tamaño

- El original se conserva byte por byte en storage content-addressed; Search y preview consumen texto derivado, nunca reemplazan el archivo original. Los endpoints de archivo protegido comprueban ACL y SHA antes de servirlo.
- Upload manual y archivo de fuente aceptan hasta 20 MiB por archivo. Los paquetes Office se leen sin ejecutar aplicaciones, macros, scripts, relaciones externas ni objetos embebidos.
- El lector ZIP rechaza entrada superior a 20 MiB, más de 2.000 entradas, miembro mayor a 32 MiB, expansión agregada superior a 64 MiB, ratio superior a 200, Zip64, cifrado, métodos no soportados, nombres duplicados o traversal, discrepancias local/central y CRC inválido.
- XML limita profundidad, tamaño de entrada y texto producido; se descartan elementos de scripts, comentarios/anotaciones y revisiones eliminadas. RTF omite grupos de objetos y no interpreta controles como código ejecutable.
- Los límites son defensa en profundidad local, no certificación contra todo archivo hostil. El extractor no accede a red ni a APIs externas.

## Provenance y estado

La extracción mantiene el extractor y su versión existentes en `CorpusExtraction`; cada ingestion guarda además `extractionProvenance` con formato detectado, MIME canónico, extensión original, método de detección, advertencias y páginas candidatas a OCR. No se cambió el schema.

En PDF, páginas con menos de 25 caracteres extraídos se señalan como candidatas OCR. Es una heurística de detección, no una medición de calidad visual. Una extracción con páginas candidatas usa `OCR_REQUIRED`, conserva y permite buscar el texto nativo de las demás páginas y muestra el original. No se presenta el documento completo como OCR-indexado.

## OCR: alcance bloqueado en esta PC

No se implementó ni se ejecutó OCR local: no están disponibles un motor Tesseract, el modelo `spa`, OCRmyPDF, Ghostscript ni un worker de OCR. La instalación local intentada no ofreció un instalador aplicable sin privilegios administrativos; no se descargaron binaries ni modelos. Por lo tanto, no hay procesamiento asíncrono OCR, límites de concurrencia, reintentos, cancelación, control de carga ni benchmark de páginas/minuto. Los PDF candidatos quedan visibles como `OCR_REQUIRED`; no se llama a cloud y no se modifica el original.

El siguiente paso debe instalar y fijar una herramienta y modelo aprobados para Windows, medir calidad con ground truth autorizado y memoria/latencia con 1/5/10 páginas, y diseñar la cola local idempotente con backpressure, cancelación, retry y health checks. Debe conservar separadamente texto nativo y OCR con provenance y abstenerse de afirmar cobertura sin validación humana. DOC necesita una conversión/extracción local segura aprobada antes de habilitarlo.

## Validación técnica

- Extractor y seguridad: 3 suites, 17 tests unitarios PASS; incluyen detección/falsificación de firma, límites ZIP, cifrado/traversal, XML hostil, macros, Unicode y DOC no soportado.
- Integración PostgreSQL DEV: fuentes 1 suite/2 tests PASS y carga/ACL de workspace 1 suite/1 test PASS; RTF/DOCX/ODT Search, provenance, original, idempotencia y denegación entre workspaces.
- Suite backend completa: 23 suites y 112 tests PASS; 7 suites/20 pruebas opt-in omitidas.
- Prisma validate/generate y migrate status: PASS; 24 migraciones al día. No se agregó migración, paquete ni binary.
- Search verify posterior: 17.078 documentos, 18.799.500 tokens, stale=0, mismatch=0/100, sin rebuild. Smoke general 21 total/20 devueltos y 0 IDs privados. Viewer general 6/6.
- Builds backend/frontend y typecheck: PASS. Lint dirigido de archivos modificados: PASS.
- Integraciones E2E y navegación completa a nivel navegador: consultar el registro de cierre en `BJC-ESTADO-ACTUAL.md`; el estado de cualquier caso fallido se informa sin inferir cobertura.
- Benchmark sintético `BasicDocumentTextExtractor.extract` (2 warmups, 20 corridas secuenciales, sin lectura de archivo): TXT 25 KB p50/p95 1,783/2,740 ms; RTF 25 KB 1,611/4,292 ms; DOCX 574 B con 25.000 caracteres 0,684/1,145 ms; ODT 488 B con 25.000 caracteres 0,632/1,658 ms; fixture PDF sintético 933 B/106 caracteres 3,961/6,701 ms. No son SLO ni se extrapolan a documentos grandes. OCR no medido; DOC no disponible. JSON: `_recovery-work/sprint154a/format-benchmark.json`.

Artefactos locales no versionados: `_recovery-work/sprint154a/`. Search corpus conservó sus conteos y proyección lógica; las suites sintéticas generaron crecimiento físico de la base por bloat, sin restos lógicos registrados tras cleanup. No se ejecutó rebuild global ni se usó corpus real como fixture nuevo.

## Exclusiones

CSV/XLS/XLSX/PPT/PPTX (P1), EML/MSG, imágenes independientes, OCR de PDFs escaneados, extracción `.doc`, migración de schema, reindexación global, OCR cloud, deploy, UAT humana y Sprints 15.4B/NEAR quedan fuera de esta entrega.
## Sprint 15.4A.1 — OCR local y DOC legado seguro (2026-10-14)

### Prerrequisitos y configuración

Runtime validado en Windows: Tesseract 5.4.0, modelo español `spa` (inglés `eng` opcional), Poppler 25.07.0 y LibreOffice 26.8.1.1. No se agregaron dependencias npm ni binarios/modelos al repositorio. Instalar herramientas desde distribución oficial/confiable; validar versiones y el modelo `spa` en cada host. En producción OCR permanece deshabilitado por defecto (`NODE_ENV=production`); `OCR_ENABLED=true` requiere decisión explícita. Si faltan herramientas/modelos, el backend arranca y reporta la capacidad como no disponible.

Variables soportadas: `OCR_ENABLED`, `OCR_ENGINE_PATH`, `OCR_RENDERER_PATH`, `OCR_TESSDATA_DIR` o `TESSDATA_PREFIX`, `OCR_LANGUAGES` (default `spa`), `OCR_DPI` (250), `OCR_TIMEOUT_MS` (90 s), `OCR_MIN_FREE_DISK_BYTES` (512 MiB), `OCR_MAX_PAGES` (2.000), `OCR_TEMP_DIR` (default temp del sistema), `OCR_MAX_PENDING_JOBS` (20) y `DOC_EXTRACTOR_PATH`. El límite de concurrencia del worker es uno por proceso. No configurar roots de almacenamiento compartido sin identidad, ACL y aceptación operativa.

### Clasificación, job y seguridad

La página con texto nativo suficiente queda `TEXT_NATIVE`; las páginas de menos de 25 caracteres se consideran candidatas `OCR_REQUIRED`. Poppler rasteriza página por página; Tesseract devuelve texto y confidence resumida. Una página reconocida queda `OCR_COMPLETE`, una falla terminal `OCR_FAILED`; el documento muestra estados de procesamiento separados de la condición inicial OCR requerida. La confidence sirve como señal técnica, no como verdad jurídica.

`CorpusOcrJob` guarda estado durable, intentos, lease, idioma, DPI, tiempo límite, SHA y fingerprint. La huella incluye archivo, páginas y versiones de motor/renderer, idioma y DPI. La reclamación es atómica; backpressure limita jobs pendientes, el worker es serial por proceso, hay heartbeat/recuperación de lease y hasta dos intentos totales. Timeout, espacio mínimo, página/tamaño máximos, stdout/stderr limitados, `spawn` con argumentos y directorios temporales únicos cubren los límites de recursos. El archivo original no se modifica. Al completar, sólo se reindexa el documento afectado.

### PDF híbrido, Search y Viewer

Se mantiene el texto nativo y sólo se OCRizan páginas candidatas; la extracción final conserva orden y tipo de texto por página. Search indexa ambas clases con ACL previa. Los matches OCR habilitan snippet, contexto, página y F3/Shift+F3, pero no un rectángulo visual: no hay bbox certificado. Errores de OCR no provocan rebuild global ni exponen el texto a Search general desde un workspace privado.

### `.doc` OLE

El detector valida firma OLE. El extractor convierte a TXT mediante LibreOffice headless con perfil temporal exclusivo, sin perfil de usuario, `macroSecurity=HIGH` y actualizaciones de vínculos remotos deshabilitadas. Usa invocación por argumentos, timeout, límite de entrada/salida y cleanup en `finally`. Archivos falsos se rechazan; marcadores de VBA/objetos embebidos se rechazan antes de convertir; los cifrados se clasifican como no soportados. No se usa Word, COM, macros ni resolución de enlaces externos.

### Evidencia y límites

El fixture sintético en español reconoció las expresiones críticas, acentos y `ñ`. La comparación 200/250/300 DPI favoreció 250 por equilibrio de calidad/costo; mediciones sobre fixtures sintéticos de 1/5/10 páginas no son una estimación universal de PDFs jurídicos reales. El benchmark de 10 conversiones DOC sintéticas terminó 10/10 (media 35,35 s; p50 30,48 s; p95 57,57 s), cerca del timeout de 60 s: la extracción no bloquea el pipeline OCR, pero el tiempo de DOC merece optimización antes de una carga masiva. Suite backend completa final: 128 PASS, 20 opt-in omitidos; integración PostgreSQL Workspace con DOC/OCR/formats 1/1 y Source 2/2; Playwright end-to-end 1/1 cubre OCR, DOC, RTF, cambio de espacio, ACL, descargas y F3/Shift+F3. Search tras cleanup: 17.078 documentos, 18.799.500 tokens, stale 0, mismatch 0/100 y rebuilt 0. Esto cierra el gate técnico local, no aceptación humana ni preproducción. Las herramientas/provenance y la evidencia completa de la máquina quedan en `_recovery-work/sprint154a1/` y no se versionan.

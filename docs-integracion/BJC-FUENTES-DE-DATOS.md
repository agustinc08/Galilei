# Fuentes de datos — estado y estrategia

## Actualización Sprint 14.3 (2026-10-09)

| Fuente | Estado verificado |
|---|---|
| TFN actual — listado público | GET server-rendered sin desafío en el listado inicial; 20 tarjetas visibles, 1 Civil en la muestra, sin paginación GET. `civil:sync` ingirió 1 sentencia real de primera instancia. Sync limitado/no exhaustivo. |
| TFN actual — filtro/backfill | HUMAN_CHALLENGE_REQUIRED para 21/08/2013–09/10/2026: el POST `acc=searchFallos` usa `cap-widget`; no fue enviado. |
| TFN — sesión humana | `civil:import:session` permite que una persona guarde el HTML/PDFs luego de una búsqueda normal y los procese offline bajo DEV guard; el helper no hace requests externos ni reutiliza CAPTCHA. |
| CIJ / Archivo CIJ | Dos notas civiles de 2018 y una referencia PDF indexada para expte. 24.971/2024; cero cruces confirmados y cero descargas por rutas prohibidas en robots. Requiere referencias autorizadas para reconciliar. |
| Corpus local Civil | 1.255 documentos: Cámara 1.254 (2008, 2009, 2013), primera instancia 1 (2026). Ver desglose por año en `BJC-ADQUISICION-JURISPRUDENCIA.md`. |

Para la metadata, hashes, conteos anuales y límites operativos actuales, usar el master de adquisición. Los párrafos históricos Sprint 14.2 que siguen describen el corte de esa fecha.

## Actualización Sprint 14 (2026-10-08)

| Fuente | Estado actual verificado |
|---|---|
| Secretaría CSJN — tomos | 421 enlaces PDF únicos / 349 números publicados. 0 descargas; búsqueda de Fallos/Sumarios incluye reCAPTCHA. `robots.txt` del host de tomos no entregó reglas legibles. El ejecutor rechazó guardar el PDF de muestra antes de ejecución. Doc 148. |
| CIJ | Sitemap permitido devuelve 873 URLs de `cij7.test:8081`, no inventario de sentencias. `sentencias.html`, `/d/`, `/scp/d/` y adjuntos PDF disallow. Doc 149. |
| TFN | Sigue `BLOCKED`: robots actual disallow página inicial y rutas PDF. Discovery M7 es histórico, no repetido. Doc 150. |
| Datos Abiertos CSJN | Cinco búsquedas públicas sin conjuntos específicos; portal declara 307 conjuntos. `/api/` y `/revision/` disallow, crawl-delay 10. Doc 151. |
| Corpus local | Se tomó el último snapshot documentado; no se reescaneó. Sprint 14 no escribió DB ni cambió archivos. Doc 156. |

Los resultados no significan que no existan más fallos; los conteos individuales y gaps de cobertura siguen desconocidos. Ver docs 146–158.

| Fuente | Uso previsto | Estado | Estrategia |
|---|---|---|---|
| CSJN — Tribunales Federales y Nacionales | Superficie actual para fallos nacionales/federales, incluidos Civil | IDENTIFICADA; NO GO para descarga automática | La URL CIJ de sentencias redirige aquí. Buscador desde 21/08/2013; primera instancia anunciada desde 2025. PDF observado bajo `/tribunales-federales-nacionales/d/`, prohibido por robots CSJN. Sin adapter ni piloto; informes 41–46. |
| CIJ histórico / fallos anteriores | Investigar cobertura civil histórica | MECANISMO INSUFICIENTE / BLOQUEADO | La URL vieja redirige en la búsqueda actual. `/archivo-cij/adj/pdfs/` aparece disallow en robots. La página “fallos anteriores” muestra total agregado, no inventario Civil. Requiere canal oficial autorizado. |
| Lex100 | Flujo institucional de resoluciones | PENDIENTE; integración sólo con mecanismo autorizado | No automatizar acceso ni conectarse sin autorización institucional expresa. |
| SQLite legacy Jurisprudencia | Referencia y migración controlada | CONFIRMADO como referencia local | Sólo read-only/immutable/query_only; no usar como arquitectura final. Fixture benchmark conocido en mapa técnico. |
| MicroISIS (`tb_microisis`) | Preservar/reconciliar conocimiento legado | PENDIENTE | No importar automáticamente sus 52.375 filas ni crear entidad productiva en esta misión. |
| PDFs/archivos locales de Jurisprudencia | Documentos asociados a sentencias | Inventariados; relación/cobertura requiere trabajo | Registrar checksum, ruta segura y procedencia; no confundir archivo disponible con publicación. |
| Roots locales de PDFs institucionales de Jurisprudencia | Corpus institucional DEV | INGESTADOS Sprint 8 | 23.829 archivos físicos en 3 roots read-only, 10.732 hashes únicos; originales intactos. 10.332 indexados, 399 OCR_REQUIRED, 1 INVALID_PDF. Vínculos/temas son sugerencias o unresolved; nunca publicación automática. Docs 53–60. |
| Servidor institucional | Documentos compartidos autorizados | FUTURO; no conectado | Indexación sólo con autorización y reglas ACL; texto encontrable, documento legible y navegación a coincidencias. |
| Digesto | Documentos administrativos y conocimiento compartido | Sistema separado analizado | Importación/autorización pendiente; conservar tipos, dependencias, colecciones y permisos propios. |
| Carga manual | Incorporación controlada | Capacidad futura | Validación, checksum, autoría, metadatos, estado editorial y auditoría. |
| Manual / fixture local | Pipeline reproducible de Corpus | IMPLEMENTADO en DEV sintético (M6) | `ManualFixtureSourceAdapter`; sin dependencia de red y con provenance/checksum. No representa autorización de documentos reales. |
| Carpeta local | Scan puntual tipo Copernic | ADAPTER IMPLEMENTADO; sin watcher | PDF/TXT, scan explícito, symlinks omitidos, path relativo sólo como procedencia. No se escanearon carpetas institucionales. |
| Copernic | Referencia de experiencia de búsqueda de archivos | No hay índice/configuración local comprobada | Usar como referencia de requisitos, no como fuente de datos ni componente del backend. |

## Reglas de procedencia

Guardar fuente, tabla/colección de origen, ID legacy, fecha de obtención y checksum cuando sea pertinente. Debe poder reconstruirse `fuente legacy + legacyId → registro destino`. No equiparar fuente de obtención con órgano judicial. Un duplicado binario no implica que dos registros jurídicos sean la misma decisión.

M6 implementó infraestructura documental genérica; M7.1 agregó paquetes JSON/CSV/carpeta; Sprint 8 cargó roots locales autorizados/read-only en PostgreSQL DEV. Esto no equivale a habilitar servidores institucionales remotos, fuente pública CSJN/CIJ, producción, publicación o ACL definitiva. Ver informes 36–40, 47–52 y 53–60 para evidencia y límites.

Misión 7 realizó únicamente discovery público de baja intensidad. `package_search` de Datos Abiertos para `fallos`, `sentencia` y `jurisprudencia` devolvió cero coincidencias; esto no demuestra inexistencia bajo cualquier otro nombre. No automatizar descargas de rutas disallow; no convertir disponibilidad pública en autorización masiva.

## Digesto local tras Sprint 10

El directorio `digesto/server/pdfs` se inventarió read-only y se integraron 276 PDFs únicos (`DIGESTO_LOCAL`, INTERNAL) al Corpus compartido en DEV. Hubo 278 rutas físicas, 2 duplicados, 264 PDFs con texto y 14 `OCR_REQUIRED`. No se halló export local con IDs/metadata de colecciones/temas/tags/dependencias. Esto sólo cubre archivos locales: no conecta Digesto institucional remoto ni confirma ownership, identidad, ACL o semántica editorial. Crosswalk: `71-CROSSWALK-DIGESTO-LEGACY-CORPUS.md`.

## Export Digesto y OCR tras Sprint 11

La especificación pedible de export está en `80-ESPECIFICACION-EXPORT-DIGESTO.md`: paquete local autorizado, manifiesto/hash, source IDs estables, documentos/taxonomía/memberships/relaciones y visibilidad propuesta explícita. No se encontró el paquete; no conectar a remoto ni inferir crosswalk. OCR segunda medición sólo probó dos páginas existentes con Tesseract; originales y capas extraídas permanecen intactos y el estado indexado no se actualiza.

## Estado Sprint 12 — disponibilidad de metadata

No se obtuvo export institucional ni crosswalk de Digesto; su metadata histórica continúa PENDING. Sprint 12 sólo validó filtros contra taxonomía local ya implementada, sin inferir IDs ni acceder a servicios remotos. CIJ/CSJN continúa NO GO para adquisición automatizada. Ver informes 97–98.

## Gate de datos Sprint 13

No se aprobó ni importó un corpus específico de preproducción porque no hay destino separado ni autorización de copia registrada. DEV existente es sólo referencia. Export/crosswalk Digesto sigue PENDING según doc 80; owners deben decidir si es requerido para piloto. Originales y roots continúan read-only; no hubo scan incremental ni cambios de proyección en Sprint 13. CIJ/CSJN automatizado continúa NO GO.


## TFN Civil — Sprint 14.2

El master operativo está en `BJC-ADQUISICION-JURISPRUDENCIA.md`. Histórico: búsqueda `buscador-de-fallos.html`, filtro Cámara Civil `tid=18`, 1.277 fichas confirmadas en 64 páginas y descarga normal `showFile` → redirect PDF; backfill global completado con 226.770 filas y 11.339 páginas. Actual: `sentencias.html` y catálogo público dinámico `C_1`, con 110 Juzgados Civiles y 14 opciones de Sala; el widget CAPTCHA impide automatizar búsquedas. Los PDFs civiles del histórico fueron reconciliados e ingeridos en DEV.

El piloto Sprint 14.2 descargó e ingirió el primer paquete TFN histórico Civil en DEV (98 hashes únicos; el total de origen filtrado es 1.277). El barrido global no terminó: consultar el checkpoint SQLite y el master de adquisición.


## Corte vigente — TFN histórico Civil, Sprint 14.2

La fuente oficial histórica confirmó 1.277 decisiones de Cámara Civil (2008–2013). Los 1.277 flids recibieron estado terminal: 1.263 PDFs verificados, 13 ya locales, 1 HTTP 404 persistente. Tras deduplicación SHA se incorporaron 1.254 documentos nuevos al Corpus DEV como INTERNAL. El backfill general cerró con 226.770/226.770 filas, 11.339/11.339 páginas y cero páginas fallidas. El buscador actual enumera 110 juzgados y 14 salas, pero no permite consultas sin intervención humana ante el widget. CIJ sin nueva ingesta. Ver `BJC-ADQUISICION-JURISPRUDENCIA.md` para comandos y evidencia.

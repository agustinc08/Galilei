# Adquisición de jurisprudencia civil

**Estado:** históricos globales y lote local Sprint 14.8 consolidados en Corpus/Search DEV; 5.738/10.600 enlaces dinámicos están clasificados y 4.862 permanecen sin intento. **Corte vigente:** 2026-10-13 (America/Argentina/Buenos_Aires), auditoría de fuentes Civil posterior a Sprint 15.1.1. Las cifras Sprint 14.7 y las primeras cifras Sprint 14.8 abajo son cortes históricos supersedidos.

## Objetivo y alcance

Recuperar decisiones civiles de primera y segunda instancia publicadas por fuentes oficiales, mantener metadata y procedencia y hacer consultables los PDFs desde Search V2. Este documento es la referencia operativa de adquisición; los informes 146–158 quedan como evidencia histórica.

Tribunales objetivo: Cámara Nacional de Apelaciones en lo Civil (todas las salas) y Juzgados Nacionales de Primera Instancia en lo Civil. No incluye a la CSJN como tribunal, tomos de Fallos, Digesto ni módulos nuevos.

## Fuentes y cobertura comprobada

### Buscador histórico TFN

- URL: `https://www.csjn.gov.ar/tribunales-federales-nacionales/buscador-de-fallos.html`.
- El formulario usa POST a la misma página, `acc=search`, `pagina` base cero y campos `jid`, `xid`, `tid`, `caratula`, `tags`, `mode`, `fecha_ini`, `fecha_fin` y auxiliares. Devuelve 20 resultados por página.
- Total anunciado y recorrido: **226.770 resultados**, **11.339/11.339 páginas completas**, sin páginas fallidas. El checkpoint es `_recovery-work/sprint142/historical.sqlite`; no se hardcodea el total.
- Fechas válidas de la colección: 2001-01-15 a 2014-08-15 (226.753 registros). Hay 17 fichas con fecha `0000`, que se conservan como fecha inválida sin inventar un año.
- La clasificación por tribunal dio 1.277 registros `CIVIL_EXACT`, todos Cámara Nacional de Apelaciones en lo Civil; **no se identificaron Juzgados Civiles de primera instancia** en estas 226.770 fichas. El filtro `tid=18` confirma 1.277 filas en 64 páginas, con rango 07/07/2008–28/08/2013: 2008=1.231, 2009=2, 2013=44. La fuente no expone una sala separada en estos registros. Este resultado describe sólo el archivo histórico, no demuestra inexistencia de fallos de primera instancia en otras fuentes.
- Distribución temporal global (el resto son años sin registros):

| Año | Fichas |
|---:|---:|
| Fecha inválida (`0000`) | 17 |
| 2001 | 2 |
| 2002 | 1 |
| 2003 | 1 |
| 2004 | 2 |
| 2006 | 3 |
| 2007 | 9 |
| 2008 | 25.713 |
| 2009 | 30.175 |
| 2010 | 36.284 |
| 2011 | 45.702 |
| 2012 | 52.639 |
| 2013 | 35.994 |
| 2014 | 228 |

- Distribución completa por tribunal:

| Tribunal | Fichas |
|---|---:|
| Cámara Nacional de Apelaciones del Trabajo | 61.302 |
| Cámara Nacional de Apelaciones en lo Comercial | 28.072 |
| Cámara Nacional de Apelaciones en lo Civil y Comercial Federal | 23.828 |
| Cámara Federal de Apelaciones de La Plata | 15.185 |
| Cámara Nacional de Apelaciones en lo Criminal y Correccional Federal | 15.161 |
| Cámara Federal de Casación Penal | 15.080 |
| Cámara Federal de Apelaciones de Rosario | 13.476 |
| Cámara Federal de Apelaciones de San Martín | 8.803 |
| Cámara Nacional de Apelaciones en lo Penal Económico | 6.951 |
| Cámara Federal de Apelaciones de Paraná | 4.918 |
| Cámara Federal de Apelaciones de Resistencia | 4.706 |
| Cámara Federal de Apelaciones de Mar del Plata | 4.489 |
| Cámara Federal de Apelaciones de Corrientes | 3.856 |
| Cámara Federal de Apelaciones de Bahía Blanca | 3.643 |
| Cámara Nacional de Apelaciones en lo Criminal y Correccional | 3.334 |
| Cámara Federal de Apelaciones de Mendoza | 2.679 |
| Cámara Federal de Apelaciones de Tucumán | 2.422 |
| Cámara Federal de Apelaciones de Comodoro Rivadavia | 2.292 |
| Cámara Federal de Apelaciones de General Roca | 1.943 |
| Cámara Nacional de Apelaciones en lo Civil | 1.277 |
| Cámara Federal de Apelaciones de Posadas | 1.185 |
| Cámara Federal de Apelaciones de Córdoba | 851 |
| Cámara Nacional de Apelaciones en lo Contencioso Administrativo Federal | 619 |
| Cámara Federal de Apelaciones de Salta | 436 |
| Cámara Federal de Apelaciones de la Seguridad Social | 247 |
| Cámara Nacional Electoral | 15 |

- Cada fila contiene jurisdicción, tribunal, expediente, carátula y fecha; `flid` identifica la descarga. La acción pública normal hace POST `acc=showFile&flid=<id>` a `scp/include/showFile.php`, recibe redirect same-site y luego descarga `/adj/fallos/*.pdf`.
- Contrato observado en `flid=220222`: POST 302 con cookie de sesión; GET al redirect con esa cookie 200 `application/pdf`, 54.650 bytes, firma PDF y SHA-256 `21009f7aa373c90051758d1e7059f65d1cec288b0f1452831bd661baf8795cbe`. No se probó si el cookie puede omitirse.
- El snapshot de robots marca disallow sobre la ruta PDF. El flujo público estándar se ejecuta sin login, CAPTCHA, token privado, endpoint alternativo ni evasión. Registrar y continuar ante error; no evadir 403/429.

### Buscador actual TFN

- URL: `https://www.csjn.gov.ar/tribunales-federales-nacionales/sentencias.html`.
- `pnpm civil:sync` lee por GET el HTML server-rendered de la lista pública, sin enviar el formulario ni invocar `cap-widget`. En la corrida del 2026-10-09 encontró 20 resultados globales visibles; 1 fue Civil de primera instancia: JUZGADO CIVIL 64 — Secretaría 94, expte. CIV 072119/2022, sentencia 2026-10-08. Cámara Civil no apareció en esa muestra.
- Identificador externo del resultado: `dfe01db5-ca63-4cf0-8193-6dbb5fbb6a0f`. El enlace `Descargar` visible resolvió al PDF oficial de 214.836 bytes, SHA-256 `39ed9ea0de1965a20e0db27577045cdb70893b04fb3c49baf802bf59049c70c7`. Se guardaron tribunal, secretaría, expediente, fecha, fuente, URL, fecha de descubrimiento y SHA en `_recovery-work/sprint143/current.sqlite`; el PDF derivado está en `_recovery-work/sprint143/objects/` y el paquete/checkpoint no se versionan.
- Pipeline completado: PDF validado (HTTP 200, MIME y firma), SHA deduplicado, paquete `TFN_ACTUAL_CIVIL` INTERNAL importado bajo guard DEV, extracción TEXT_EXTRACTED de 21 páginas/53.476 caracteres, Search V2 por término encontrado, visor y archivo verificados. Resultado Corpus `INDEXED`; la búsqueda por texto retornó 101 resultados y encontró el documento con un match de página. Proyección después de ingestión: 12.263 documentos, 10.038.148 tokens, stale=0, mismatches=0 en muestra 100.
- El HTML observado contiene 20 tarjetas y no presenta paginación para el listado inicial. El orden de la muestra es no creciente por fecha. El JavaScript reserva paginación para el POST filtrado `acc=searchFallos` con campo/token `cap-widget`; no se envió ese POST ni se resolvió/reutilizó CAPTCHA. La ventana inicial observada fue 2026-09-24 a 2026-10-09.
- El enlace de PDF visible cae bajo `/tribunales-federales-nacionales/d/`, que `robots.txt` marca Disallow. La comprobación se registra como señal de política; Sprint 14.3 siguió una vez el enlace `Descargar` literal visible en la lista, conforme al alcance de adquisición autorizado por esta misión. No se adivinaron URLs/IDs ni se siguieron rutas alternativas; el sync sólo seguirá futuros links `Descargar` que aparezcan en ese listado normal, sin enumerar el namespace `/d/` ni construir URLs.
- Dos ejecuciones consecutivas de `pnpm civil:sync`: primera: 1 Civil nuevo, 1 PDF descargado, 1 documento importado; segunda: 0 IDs nuevos, 0 PDFs, 0 imports, 0 duplicados. Ambas leyeron la misma tarjeta y no se creó otro objeto/documento.
- **Estado del sync: `PARTIAL_BOUNDED_FEED`, no confiable como cobertura exhaustiva.** Sólo vuelve a revisar todos los IDs Civil de las 20 tarjetas visibles; más de 20 publicaciones generales entre corridas pueden desplazar un fallo Civil sin detección. No hay cursor/paginación pública observable en el GET del listado. La ventana de solapamiento no convierte ese límite en garantía.
- `pnpm civil:backfill` continúa el inventario global histórico ya completo; no ejecuta backfill 2013→hoy. La consulta actual filtrada requerida para 21/08/2013–09/10/2026, tribunales Cámara y Juzgados Nacionales en lo Civil, corresponde a **`CURRENT_BACKFILL_FILTERED = HUMAN_CHALLENGE_REQUIRED`**: POST `acc=searchFallos` con filtro de tribunal/fecha y token de `cap-widget`. No se intentó el POST. El catálogo previo identifica Cámara `C_1`, 110 Juzgados y 14 opciones de sala, pero no equivale a fallos conocidos.
- Alternativa humana implementada: después de ejecutar búsqueda normal y resolver el desafío en el sitio, guardar el HTML de resultados y descargar manualmente los PDFs desde sus enlaces `Descargar` a una carpeta. Ejecutar `pnpm civil:import:session -- --html=<archivo.html> --pdf-dir=<carpeta>`; la herramienta no hace requests externos ni lee/reutiliza tokens, sólo toma tarjetas Civil, hace match exacto por filename UUID, valida firma/hash, crea el paquete de Corpus y lo pasa por dry-run/import y verificación Search/visor bajo el DEV guard. PDFs sin nombre exacto quedan pending y no se ingieren. No altera los archivos entregados.
- El importador manual pasó smoke offline con una tarjeta guardada y el PDF del piloto: dry-run `new=0/alreadyKnown=1`, recibo `ALREADY_IMPORTED`, `externalNetworkRequestsMade=0`; Search y visor siguieron dando PASS. El fixture queda bajo `_recovery-work/sprint143/manual-fixture/` y no se versiona.
- El parser de sync reconoce Cámara Nacional de Apelaciones en lo Civil y el alias publicado `Cámara Civil` con sala A–M o Sala Feria, y Juzgado Civil/Nacional en lo Civil con número y secretaría. Excluye expresamente Cámara Civil y Comercial Federal. Se mantiene el tribunal como evidencia principal; el expediente `CIV` no clasifica por sí solo.

### CIJ

Discovery dirigido de Sprint 14.3, sin rastreo general ni descarga. La página oficial informa que CIJ fue disuelto por Acordada 10/2025 y que su contenido se conserva en el Archivo CIJ. `robots.txt` de `cij.gov.ar` prohíbe `/d/`, `/*/d/`, `/scp/d/`, `/adj/fallos/`, `/scp/include/` y `/sentencias.html`; el host `cij7.test:8081` del sitemap sigue sin sustituirse por un host institucional.

Se revisaron páginas-nota oficiales permitidas para dos leads de la brecha 2014+: (1) [Sala D, fecha de nota 2018-12-17, robo en local comercial](https://www.cij.gov.ar/nota-32872-La-C-mara-Nacional-de-Apelaciones-en-lo-Civil-hizo-lugar-a-una-demanda-contra-un-local-comercial-por-el-robo-sufrido-por-un-cliente-dentro-del-establecimiento.html); (2) [Sala M, fecha de nota 2018-12-26, límite de cobertura de seguro](https://www.cij.gov.ar/nota-32986-La-C-mara-Nacional-de-Apelaciones-en-lo-Civil-resolvi--que-el-l-mite-de-cobertura-establecido-en-un-contrato-de-seguro-debe-ajustarse-a-la-normativa-vigente-al-momento-del-pago-de-la-condena.html). Las notas identifican tribunal/sala y resumen, pero no muestran expediente/carátula suficiente para crossmatch; el PDF se referencia mediante iframe no inspeccionado porque las rutas directas observadas/indexadas caen bajo `/d/` u otra ruta disallow. **Matched BJC: 0 confirmables; PDFs CIJ descargados/recuperados: 0.** Quedan como leads pendientes de referencia de expediente o paquete institucional autorizado, no como fallos ingresados.

Un resultado de índice para un PDF de Juzgado Civil 15, expte. 24.971/2024, apareció en búsqueda dirigida; su ruta `/scp/d/` está disallow y no se abrió. No se pudo verificar fecha de sentencia, carátula ni hash. El crossmatch exacto `CorpusDocument.caseNumber contains "24.971/2024"` en DEV devolvió 0 filas. Cuenta como un lead indexado pendiente, no como adquisición o candidato validado. No se usó endpoint AJAX, PDF disallow, sitemap host interno ni token.

## Manifest, clasificación y deduplicación

- SQLite reanudable: `_recovery-work/sprint142/historical.sqlite`. Guarda resultados, páginas confirmadas, filtros, estado de descarga, SHA, bytes y errores. El sitio devuelve ISO-8859-1; el parser decodifica con charset y valida el tamaño esperado de cada página.
- `CIVIL_EXACT` requiere tribunal estructurado inequívoco o filtro `tid=18`; la palabra “civil” en carátula no basta.
- Deduplicación física por SHA-256. Importaciones se preparan como paquetes de Corpus y se reconcilian contra DEV antes de escribir. IDs que comparten bytes conservan procedencias relacionadas.
- El manifest no se versiona. PDFs verificados quedan en `_recovery-work/sprint142/pilot/`; storage existente y roots de origen son de sólo lectura.

## PDFs Civiles y Corpus DEV

| Medida | Resultado |
|---|---:|
| Flids Civil del histórico | 1.277 |
| PDFs con GET 200, MIME y firma validados | 1.263 |
| Bytes en respuestas verificadas | 30.276.609 |
| Ya presentes en storage local | 13 |
| Fallido | 1: `flid=101`, HTTP 404 también en el reintento único |
| SHA únicos entre los 1.263 verificados | 1.254 (9 IDs duplicados por contenido) |
| Nuevos documentos incorporados al Corpus | 1.254 |
| Resultado de extracción | 1.253 INDEXED; 1 OCR_REQUIRED; 4.453 páginas; 7.457.999 caracteres |
| Corpus antes → después | 11.008 → 12.262 documentos |
| Visibilidad | INTERNAL para todas las importaciones |

El paquete final reconcilió 1.155 hashes ya existentes en Corpus e incorporó 99; el acumulado de la fuente durante la misión fue 1.254 documentos nuevos. La importación idempotente final informó 0 nuevos, 1.254 existentes y 0 fallidos.

## Search V2 después de la ingesta

- Proyección: 12.262 documentos, 10.035.849 tokens, stale=0 y mismatch=0 en muestra de 100; Search smoke y visor PASS.
- Rendimiento, 10 requests por familia: TERM p50/p95 113/227 ms; PHRASE 270/538 ms; HTTP 200.
- EXPLAIN: 5 planes PASS. Parser: 7 aserciones PASS. `pnpm test`: 20 suites/93 tests PASS, 5 suites/15 tests omitidos. Backend `build`: PASS.
- Smoke del visor: un fallo Civil nuevo por texto, PDF de 23.964 bytes, página 1 y tres matches.

## Comandos operativos

Ejecutar desde `JurisprudenciaN/back`:

| Comando | Función |
|---|---|
| `pnpm civil:backfill` | Continuar inventario histórico completo desde checkpoint SQLite; no descarga PDFs. Estado actual: 11.339/11.339 páginas completas. |
| `pnpm civil:backfill:filter` | Revalidar enumeración estructurada Civil `tid=18`. |
| `pnpm civil:download:pilot -- --new-only --limit=200 --delay-ms=750` | Lote de flids sin resultado terminal, secuencial y reanudable. |
| `pnpm civil:download:pilot -- --ids=<flid> --retries=1` | Reintento puntual documentado. |
| `pnpm civil:package:prepare` | Preparar paquete deduplicado para Corpus. |
| `pnpm corpus:package:validate <ruta>` | Verificar manifiesto y archivos. |
| `pnpm corpus:package:dry-run <ruta>` | Reconciliar hashes contra DEV sin escribir. |
| `pnpm corpus:package:import <ruta>` | Ingestar tras dry-run PASS; guard exige DB local DEV exacta. |
| `pnpm civil:verify-pilot` | Verificar procedencia, extracción, Search, página, matches y PDF en DEV. |
| `pnpm civil:sync` | Lee la lista pública reciente sin enviar filtros; reintenta todos los IDs Civil dentro de las 20 tarjetas visibles y pasa los PDFs nuevos por Corpus/Search bajo DEV guard. Salida esperada: `PARTIAL_BOUNDED_FEED`; no es sync exhaustivo. |
| `pnpm civil:import:session -- --html=<archivo.html> --pdf-dir=<carpeta>` | Procesar offline los resultados/PDFs guardados manualmente tras una sesión normal; no resuelve CAPTCHA ni hace requests externos. |
| `pnpm civil:status` | Estado de manifests y coverage Corpus por año/instancia mediante consulta read-only detrás del guard DEV. |
| `pnpm civil:coverage` | Sólo inventario Corpus Civil por año/instancia/tribunal, read-only y guardado. |
| `pnpm civil:test:parser` | Aserciones offline del parser. |

Toda escritura PostgreSQL pasa por `scripts/with-dev-db-guard.cjs` y valida `bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev`. No usar DB productiva ni servidores institucionales.

## Gaps y siguientes acciones

1. Histórico global: 226.770/226.770 filas y 11.339/11.339 páginas; 17 fechas inválidas permanecen sin año inventado.
2. Cámara histórica: 1.277 IDs fuente de 2008–2013 (2008=1.231, 2009=2, 2013=44). Corpus local tiene 1.254 documentos distintos de Cámara: 2008=1.210, 2009=2, 2013=42; 1.253 INDEXED y 1 OCR_REQUIRED. Estos conteos difieren porque fuente/IDs de fallo y hashes/documentos Corpus tienen distinta cardinalidad.
3. PDFs históricos: 1.276 IDs con PDF local/verificado, 1 PDF sigue HTTP 404 (`flid=101`); los hashes duplicados se deduplicaron en Corpus. No quedan páginas ni jobs históricos pendientes.
4. Primera instancia: sólo 1 sentencia conocida en la muestra actual, del Juzgado Civil 64, fecha 2026-10-08, PDF y Corpus INDEXED. No se infieren totales anuales de la muestra de 20.
5. Cámara Civil: el Corpus local tiene años 2008, 2009 y 2013, ningún documento de Cámara entre 2010–2012 ni después de 2013. Es un gap de cobertura conocida del dataset adquirido, no prueba de inexistencia de fallos.
6. Backfill actual de 2013-08-29 a 2026-10-09 para Cámara + Juzgados: `HUMAN_CHALLENGE_REQUIRED` (formulario POST con `cap-widget`). El feed reciente público no ofrece navegación exhaustiva; sync parcial, limitado a las 20 tarjetas.
7. CIJ: 0 matches confirmables y 0 nuevos recuperados; 2 notas de Cámara de 2018 sin expediente y 1 lead indexado 24.971/2024 sin apertura por ruta `/scp/d/`. Requiere referencias/permisos de adquisición para su crossmatch.

## Cobertura anual consolidada — Corpus DEV, Sprint 14.3

Conteos de documentos distintos Corpus (PDF/hashes deduplicados), no cantidad de IDs de resultados fuente:

| Año | Cámara en Corpus | 1ª instancia en Corpus | Total Civil en Corpus | PDFs en Corpus | OCR requerido | Fuente / nota |
|---:|---:|---:|---:|---:|---:|---|
| 2008 | 1.210 | 0 | 1.210 | 1.210 | 1 | Histórico TFN; 1.231 IDs fuente |
| 2009 | 2 | 0 | 2 | 2 | 0 | Histórico TFN; 2 IDs fuente |
| 2010 | 0 | 0 | 0 | 0 | 0 | Gap de cobertura del inventario adquirido |
| 2011 | 0 | 0 | 0 | 0 | 0 | Gap de cobertura del inventario adquirido |
| 2012 | 0 | 0 | 0 | 0 | 0 | Gap de cobertura del inventario adquirido |
| 2013 | 42 | 0 | 42 | 42 | 0 | Histórico TFN; 44 IDs fuente, año parcial desde 2013-01-01 |
| 2014–2025 | 0 | 0 | 0 | 0 | 0 | Brecha de adquisición; no implica que no existan fallos |
| 2026 | 0 | 1 | 1 | 1 | 0 | Feed reciente; sólo 20 resultados visibles, no total anual |
| **Total** | **1.254** | **1** | **1.255** | **1.255** | **1** | Corpus `court` verificado por consulta guardada |

El inventario se generó con `pnpm civil:coverage` y se contrastó con Search Projection: 12.263 documentos, 10.038.148 tokens, `stale=0`, 0 mismatches en muestra de 100. No se repitió benchmark TERM/PHRASE porque el cambio neto fue un único PDF.

## Reglas permanentes

- Leer este documento antes de toda adquisición; actualizarlo en lugar de crear informes numerados.
- No repetir auditorías cerradas si datos/código no las contradicen.
- No automatizar ni sortear CAPTCHA, login, token privado, 403 o rate limit.
- No mover, renombrar ni borrar fuentes originales. Usar storage content-addressed.
- No declarar producción, aceptación institucional o cobertura completa con resultados locales.

## Actualización Sprint 14.4 — 2026-10-09

Esta actualización supersede el corte de cobertura 14.3. Sólo refleja resultados confirmados; los resultados de búsqueda indexados y las fichas pendientes no se cuentan como documentos de Corpus.

### Cuantificación de daños — inventario y adquisición

Fuente oficial: [Gestión Judicial PJN](https://www.pjn.gov.ar/gestion-judicial) enlaza la base de la Cámara Nacional de Apelaciones en lo Civil, disponible en [Consultas de cuantificación de daños](http://consultas.pjn.gov.ar/cuantificacion/civil/). La portada declara precedentes desde 1993 hasta la actualidad y cinco bases temáticas. La consulta pública no pidió login ni mostró challenge. Los filtros visibles permitieron recorrer la Cámara/Sala por formularios normales; 132 búsquedas terminaron sin error (106 con resultados y 26 con cero), sin paginación visible.

| Medida | Resultado confirmado |
|---|---:|
| Enlaces de detalle encontrados | 15.478 URLs distintas; no equivalen a casos únicos por expediente |
| Detalles abiertos e inspeccionados | 88 |
| Expedientes distintos identificados en la muestra | 48 |
| Fechas observadas en la muestra | 1993-08-27 a 2026-09-16; no son límites exhaustivos de la base |
| Sentencias completas con PDF validado | 1 |
| Fichas con metadata y visor sin documento | 87 |
| Fallas de red/PDF | 0 |
| Detalles que aún no se inspeccionaron | 15.390 |

La única sentencia completa recuperada es **Basso, Alejandra Elena c/ Liderar Compañía General de Seguros y otros**, expte. 91273/2013, Sala J, sentencia de Cámara 2017-10-10 (primera instancia 2017-02-16), registro 19129. El PDF oficial respondió HTTP 200, MIME `application/pdf`, firma `%PDF-`, 140.282 bytes, SHA-256 `429581b67ba5a3d42648f920a9fba8bdf27193f409d2610eaa93c02aadc658f8`; el texto y las siete páginas se verificaron. Se importó como `INTERNAL`, quedó `INDEXED` y se reutilizó la extracción en Search. La segunda lectura del mismo registro confirmó que el iframe vigente debe distinguirse de un iframe legado comentado.

`consultas.pjn.gov.ar/robots.txt` devolvió 404; no se interpreta como autorización general de crawling. El crawler limitó las consultas a los formularios y enlaces públicos observados, secuenciales y reanudables.

Las 87 fichas inspeccionadas como `METADATA_ONLY` conservan expediente, carátula, Sala y fecha cuando esos campos existen; el enlace ordinario de sentencia termina en un visor cuyo `doOpen` está vacío. No son PDFs recuperables desde la vista pública observada. La muestra fue exploratoria y no aleatoria: no se extrapola el 1/88 al universo de 15.478 apariciones. El claim “desde 1993” es cobertura declarada por la fuente, no un conteo anual comprobado.

El paquete del registro 19129 inicialmente produjo una segunda fila lógica con el mismo SHA por diferencia de `externalId`. Se detectó en DEV, se eliminó la fila duplicada bajo `with-dev-db-guard.cjs` tras comprobar hash, expediente, fecha, Sala, carátula y ausencia de curación/vínculos, y quedó una sola fila Corpus. El importador ahora normaliza `LESIONES_POST_2015` al identificador legado `lesiones_po` y detiene lotes nuevos cuando un SHA ya existe en Corpus bajo otra identidad externa y necesita revisión.

### Buscador actual — backfill de sesión humana

Se incorporó `pnpm civil:harvest:session` (Edge visible, perfil aislado, checkpoint SQLite y paginación por controles visibles). La búsqueda preparada usa jurisdicción Ciudad de Buenos Aires, Cámara Civil (`C_1`) sin limitar Sala, desde 21/08/2013 hasta 09/10/2026. La rutina nunca serializa ni lee el DOM del challenge, ni obtiene, persiste, inyecta o reutiliza su token. El proceso de esta misión queda esperando que una persona complete el `cap-widget` y pulse **Buscar** una vez en Edge; todavía no se cuenta ningún resultado de ese backfill. Si una página posterior vuelve a pedir challenge, se registra y detiene.

La última consulta pública sin filtros expuso 20 tarjetas, 1 Civil (Juzgado Civil 64, fecha 2026-10-08) y ninguna paginación visible. El filtro amplio por fuero está preparado para la búsqueda humana; no se ejecutaron 110 búsquedas por juzgado.

### CIJ y búsqueda indexada — leads, sin descarga

CIJ sigue siendo gap finder: las dos notas previamente identificadas (Sala D y Sala M, diciembre de 2018) no muestran expediente/carátula suficientes; siguen con 0 matches confirmables y 0 recuperaciones. La búsqueda dirigida también devolvió referencias indexadas a fallos civiles de Sala M (expte. 4.048/2021, firma 2024-12-23) y dos rutas `/scp/d/` con extractos parciales; son leads de índice, no documentos incorporados. `robots.txt` vigente de CIJ prohíbe `/d/`, `/*/d/`, `/scp/d/`, `/sentencias.html` y rutas de descarga relacionadas; no se abrieron esos PDFs ni las rutas restringidas.

La búsqueda complementaria encontró **6 PDFs oficiales CSJN** con metadatos en snippets de índice, todos con firma en 2025: Cámara Civil Sala M (60.683/2021 y 72.091/2019), Sala D (33.634/2020), Sala E (42.216/2018), Juzgado Civil 15 (2025-09-23) y Juzgado Civil 95 (2025-09-18). Sus enlaces apuntan a `/tribunales-federales-nacionales/d/`, que el [robots.txt de CSJN](https://www.csjn.gov.ar/robots.txt) declara disallow. No se descargaron ni abrieron. Son 6 leads de búsqueda; por fecha y mapa Corpus, 6 pendientes de crossmatch documental, 0 PDFs nuevos en Corpus y 0 duplicados confirmados. Los extractos de buscador no son prueba exhaustiva ni sustituyen un cotejo de PDF autorizado.

### Sync, Corpus, Search y mapa anual

`civil:sync` registró 20 tarjetas, 1 Civil, fechas visibles mínima/máxima 2026-10-08, 1 ID Civil ya conocido, 0 nuevos, 0 descargas y `PARTIAL_BOUNDED_FEED`. Dos ejecuciones seguidas mantuvieron 20 IDs, con `possibleFeedGap=false`. El control compara dos snapshots completos de 20 IDs y marca `POSSIBLE_FEED_GAP` si no hay intersección. `CIVIL_SYNC_INTERVAL` se toma del entorno y se emite en el estado (`12h` verificado); por defecto el comando es manual y no se instaló un scheduler.

Tras deduplicar el caso cuantificado, DEV quedó con **12.264 documentos**, **10.039.190 tokens**, proyección lista, `stale=0` y 0 mismatches en muestra de 100. Corpus Civil: **1.256 documentos** (1.255 Cámara y 1 primera instancia). No se midió benchmark por el incremento neto de un único documento; la última referencia conservada sigue siendo TERM 113/227 ms y PHRASE 270/538 ms.

Mapa unificado: “Corpus” cuenta documentos únicos ya incorporados; “fuentes/leads” no implica cobertura exhaustiva. Años ausentes describen el dataset adquirido, no inexistencia de fallos.

| Año | Cámara en Corpus | 1ª instancia en Corpus | Histórico | Cuantificación | Current | CIJ | Local | Search index / pendiente |
|---:|---:|---:|---|---|---|---|---|---|
| 1993 | 0 | 0 | — | La fuente declara cobertura desde 1993; anualidad pendiente | — | — | — | Inventariar |
| 1994 | 0 | 0 | — | Pendiente de desglose anual | — | — | — | Inventariar |
| 1995 | 0 | 0 | — | Pendiente de desglose anual | — | — | — | Inventariar |
| 1996 | 0 | 0 | — | Pendiente de desglose anual | — | — | — | Inventariar |
| 1997 | 0 | 0 | — | Pendiente de desglose anual | — | — | — | Inventariar |
| 1998 | 0 | 0 | — | Pendiente de desglose anual | — | — | — | Inventariar |
| 1999 | 0 | 0 | — | Pendiente de desglose anual | — | — | — | Inventariar |
| 2000 | 0 | 0 | — | Pendiente de desglose anual | — | — | — | Inventariar |
| 2001 | 0 | 0 | — | Pendiente de desglose anual | — | — | — | Inventariar |
| 2002 | 0 | 0 | — | Pendiente de desglose anual | — | — | — | Inventariar |
| 2003 | 0 | 0 | — | Pendiente de desglose anual | — | — | — | Inventariar |
| 2004 | 0 | 0 | — | Pendiente de desglose anual | — | — | — | Inventariar |
| 2005 | 0 | 0 | — | Pendiente de desglose anual | — | — | — | Inventariar |
| 2006 | 0 | 0 | — | Pendiente de desglose anual | — | — | — | Inventariar |
| 2007 | 0 | 0 | — | Pendiente de desglose anual | — | — | — | Inventariar |
| 2008 | 1.210 | 0 | 1.231 IDs fuente | Sin desglose completo | — | — | — | — |
| 2009 | 2 | 0 | 2 IDs fuente | Sin desglose completo | — | — | — | — |
| 2010 | 0 | 0 | Sin registros adquiridos | Sin desglose completo | — | — | — | Gap de adquisición |
| 2011 | 0 | 0 | Sin registros adquiridos | Sin desglose completo | — | — | — | Gap de adquisición |
| 2012 | 0 | 0 | Sin registros adquiridos | Sin desglose completo | — | — | — | Gap de adquisición |
| 2013 | 42 | 0 | 44 IDs fuente | Un expediente del piloto refiere a 2013; fecha de Cámara 2017 | — | — | — | — |
| 2014 | 0 | 0 | — | Sin desglose anual | — | — | — | Backfill pendiente |
| 2015 | 0 | 0 | — | Sin desglose anual | — | — | — | Backfill pendiente |
| 2016 | 0 | 0 | — | Sin desglose anual | — | — | — | Backfill pendiente |
| 2017 | 1 | 0 | — | 1 fallo completo y verificado | — | — | — | — |
| 2018 | 0 | 0 | — | Sin desglose anual | — | 2 notas sin crossmatch | — | 1 fallo Sala E, firma 2025 |
| 2019 | 0 | 0 | — | Sin desglose anual | — | — | — | 1 fallo Sala M, firma 2025 |
| 2020 | 0 | 0 | — | Sin desglose anual | — | — | — | 1 fallo Sala D, firma 2025 |
| 2021 | 0 | 0 | — | Sin desglose anual | — | — | — | 1 fallo Sala M, firma 2025 |
| 2022 | 0 | 0 | — | Sin desglose anual | — | — | — | Backfill pendiente |
| 2023 | 0 | 0 | — | Sin desglose anual | — | — | — | Backfill pendiente |
| 2024 | 0 | 0 | — | Sin desglose anual | — | 1 lead indexado sin descarga | — | — |
| 2025 | 0 | 0 | — | Sin desglose anual | — | — | — | 6 leads oficiales bajo ruta disallow |
| 2026 | 0 | 1 | — | Fuente actualizada hasta septiembre en muestra; sin total anual | Juzgado Civil 64, 2026-10-08 | — | — | Consulta amplia pendiente |

### Estado de Sprint 14.4 y próximo gap

- **Cuantificación: PARTIAL.** 15.478 apariciones encontradas; sólo 88 detalles inspeccionados; 1 PDF completo en Corpus y 87 metadata-only. Quedan 15.390 detalles por revisar y sin paginación visible en consultas.
- **Current backfill: BLOCKED ON HUMAN CHALLENGE.** Edge tiene una búsqueda amplia preparada; falta el envío humano normal y que el recolector complete páginas/PDFs.
- **CIJ: PARTIAL/BLOCKED BY ROBOTS.** Leads documentados; sin descargas ni crossmatch de rutas disallow.
- **Search-index: PARTIAL/BLOCKED BY ROBOTS.** Seis referencias oficiales 2025 en ruta disallow, sin PDF local.
- **Sync: PARTIAL.** Idempotente para el ID reciente; ventana limitada a 20 tarjetas y conserva `PARTIAL_BOUNDED_FEED`.

**Siguiente gap comprobado:** los **15.390 detalles de cuantificación aún no inspeccionados**. El recolector queda reanudable; la búsqueda humana amplia 2013-08-21→2026-10-09 ya está preparada en Edge y continuará cuando se envíe el formulario tras el challenge.


## Sprint 14.5 — inventario completo de Cuantificación Civil — 2026-10-09

### Cuantificación e inspección

Se reutilizó el checkpoint existente; las 15.478 URLs de detalle quedaron clasificadas, con **0 fichas pendientes de inspección** al cierre. Las búsquedas fuente siguen siendo 106 consultas con resultados (15.478 enlaces) y 26 consultas con cero resultados. Las URLs de distintas categorías pueden referir al mismo expediente: el inventario distingue filas fuente de casos deduplicados.

- Casos conocidos deduplicados por expediente/caso: **14.142**; IDs oficiales distintos: **12.819**.
- Rango de fechas de Cámara válido observado: **1993-02-02 a 2026-10-07**. La ficha 444 publica literalmente 31/03/3022; se conservó como advertencia textual, se dejó su fecha de Cámara nula y se mantuvo 2021-03-25 como fecha de primera instancia. No se corrigió por inferencia.
- Clasificación de filas: **223 documentos dinámicos descargados**, **1 PDF previamente verificado**, **20 textos completos**, **4.629 metadata-only**, **10.600 requieren acceso humano al visor**, **5 vacías**, **0 rotas**, **0 desconocidas**. Los 10.600 enlaces al visor se inventariaron sin volver a consultar su host después de recibir allí una página de CAPTCHA/login.

### Visor y recuperación de contenido

La secuencia visible confirmada es ficha de detalle → contenedor_sen.php → iframe form_sen.php → doOpen(...) → PDF oficial en scw.pjn.gov.ar. Se validaron respuestas como application/pdf y firma %PDF-; el PDF de ejemplo se guardó por hash. Cuando un request al visor devolvió HTML de CAPTCHA/login, se detuvieron esos requests: no se automatizó ni sorteó el desafío. La cola de reanudación sólo leyó páginas del host de consultas y marcó los enlaces dinámicos como REQUIRES_HUMAN.

- PDFs verificados: **224 filas fuente**, **223 SHA-256 únicos**, **1 fila duplicada**, **53.958.175 bytes**. Las filas verificadas se importaron idempotentemente al Corpus/DEV.
- Textos completos verificables importados como documentos de texto: **20**, sin convertir metadata en sentencia.
- PDFs directos en fichas: **0** en el inventario final; los 223 casos recuperados usaron el flujo dinámico del visor.
- OCR masivo: no ejecutado.

### Crossmatch y Corpus

El crossmatch local cubrió **15.478/15.478** filas, contra el snapshot del Corpus y el manifest histórico (read-only). Cotejó expediente, Sala, fecha y carátula; los candidatos no se autofusionaron.

| Resultado por fila fuente | BJC Corpus | Histórico CSJN/TFN |
|---|---:|---:|
| EXACT | 222 | 0 |
| HIGH_CONFIDENCE | 6 | 6 |
| CANDIDATE | 283 | 55 |
| UNRESOLVED | 14.967 | 15.417 |

BJC: los matches EXACT/HIGH_CONFIDENCE representan **224 documentos únicos** (**204 con PDF y 20 con texto completo**); **219** ya tienen procedencia CIVIL_CUANTIFICACION_DANOS, y 5 eran fallos históricos ya existentes sin ese source link. Esto equivale a 223 expedientes/casos distintos con algún documento confirmado y **13.919 casos** sin documento confirmado en BJC; **13.938** siguen sin PDF confirmado. Los 283 candidatos requieren cotejo y no cuentan como recuperados.

Histórico: 1.277 filas civiles del manifest; no se volvió a crawl-ear el universo histórico. Hubo 6 coincidencias de alta confianza y 55 candidatos, pero **0 PDFs históricos alternativos recuperables**: sus archivos siguen PENDING_ROBOTS_DISALLOW. CIJ: 0 matches confirmables en esta comparación.

Corpus Civil DEV: antes **1.256 documentos** (1.255 Cámara y 1 de primera instancia); después **1.474** (1.473 Cámara y 1 de primera instancia); incremento neto **218 documentos** —198 PDFs de Cámara nuevos respecto de la línea base y 20 textos completos—. Snapshot: 1.254 fuentes CSJN_TFN_HISTORICAL, 219 CIVIL_CUANTIFICACION_DANOS y 1 TFN_ACTUAL_CIVIL.

### Cobertura anual

Casos únicos se deduplican por expediente y, en su ausencia, ID de la ficha. Los PDF hash son documentos verificados de Cuantificación en DEV; la tabla no presume que una anualidad esté exhaustivamente publicada fuera del inventario de esta fuente. Puede haber solapamiento entre categorías y estados de un mismo caso.

| Año | Fichas/fuentes | Expedientes/casos únicos | PDF hashes verificados | Casos metadata-only | Casos con visor pendiente |
|---:|---:|---:|---:|---:|---:|
| 1993 | 132 | 123 | 0 | 123 | 0 |
| 1994 | 154 | 142 | 0 | 142 | 0 |
| 1995 | 157 | 146 | 0 | 146 | 0 |
| 1996 | 155 | 150 | 0 | 149 | 1 |
| 1997 | 136 | 126 | 0 | 126 | 0 |
| 1998 | 139 | 132 | 0 | 132 | 0 |
| 1999 | 138 | 131 | 0 | 131 | 0 |
| 2000 | 173 | 161 | 0 | 160 | 1 |
| 2001 | 201 | 186 | 0 | 186 | 0 |
| 2002 | 234 | 223 | 0 | 223 | 0 |
| 2003 | 158 | 143 | 0 | 143 | 0 |
| 2004 | 183 | 161 | 0 | 160 | 0 |
| 2005 | 232 | 216 | 0 | 216 | 0 |
| 2006 | 284 | 264 | 0 | 264 | 0 |
| 2007 | 235 | 223 | 0 | 223 | 0 |
| 2008 | 198 | 187 | 0 | 187 | 0 |
| 2009 | 245 | 230 | 0 | 230 | 0 |
| 2010 | 239 | 224 | 0 | 224 | 0 |
| 2011 | 251 | 238 | 0 | 238 | 0 |
| 2012 | 234 | 212 | 0 | 209 | 1 |
| 2013 | 257 | 239 | 0 | 236 | 5 |
| 2014 | 315 | 299 | 0 | 298 | 0 |
| 2015 | 380 | 363 | 10 | 121 | 231 |
| 2016 | 830 | 759 | 23 | 7 | 727 |
| 2017 | 830 | 757 | 34 | 3 | 720 |
| 2018 | 987 | 901 | 29 | 4 | 869 |
| 2019 | 1089 | 996 | 21 | 4 | 970 |
| 2020 | 566 | 512 | 13 | 1 | 499 |
| 2021 | 757 | 665 | 19 | 5 | 643 |
| 2022 | 1472 | 1291 | 12 | 10 | 1275 |
| 2023 | 1556 | 1382 | 24 | 13 | 1343 |
| 2024 | 946 | 867 | 14 | 5 | 846 |
| 2025 | 930 | 875 | 13 | 5 | 855 |
| 2026 | 676 | 626 | 11 | 5 | 606 |
| UNKNOWN | 9 | 4 | 0 | 0 | 4 |

### Search, sync y backfill de sesión humana

Después de la última ingesta, el guard verificó el Search Projection DEV exacto bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev: **12.482 documentos**, **10.391.916 tokens**, stale=0, **0 discrepancias** en muestra de 100 y sin persistencia de texto de consulta. El lote adicional de 20 textos no justificó volver a correr TERM/PHRASE; siguen como referencia los resultados medidos previamente (TERM 113/227 ms; PHRASE 270/538 ms).

El proceso ya abierto del backfill actual CSJN está en WAITING_HUMAN_CHALLENGE, para 21/08/2013–09/10/2026; su checkpoint registra **0 páginas y 0 fallos cosechados**. No se declaró resuelto el cap-widget ni se intentó automatizarlo. civil:sync no se modificó; sigue el último estado confirmado de 20 tarjetas, PARTIAL_BOUNDED_FEED, possibleFeedGap=false.

Validaciones: parser/visor/PDF/fecha/entidades **15 assertions PASS**; crossmatch **7 PASS**; corpus-package-tests bajo DEV guard **2/2 PASS**, con deduplicación por hash e importación repetida idempotente; pnpm exec tsc --noEmit PASS; pnpm build PASS; verificación final Search Projection PASS.

### Estado de Sprint 14.5

- **Cuantificación:** PASS — 15.478 fichas clasificadas, cero pendientes de inspección.
- **PDF recovery:** PARTIAL — 224 filas PDF verificadas, más 20 textos; 10.600 rutas de visor requieren intervención humana normal.
- **Crossmatch:** PARTIAL — comparación completa; quedan 283 candidatos y 14.967 filas sin match fuerte por fuente.
- **Ingesta:** PASS para documentos con contenido; no se ingirió ninguna ficha sólo metadata como sentencia.
- **Mayor gap siguiente:** obtener acceso humano normal al visor oficial y reanudar la recuperación de los 10.600 documentos dinámicos; luego reevaluar las 4.629 fichas metadata-only contra fuentes permitidas.

Comandos de continuidad: pnpm civil:quantification:status, pnpm civil:quantification:resume; tras despejar el desafío oficial, pnpm civil:quantification:viewer:retry. El checkpoint queda en _recovery-work/sprint144/quantification/checkpoint.sqlite; el crossmatch offline en _recovery-work/sprint144/quantification/crossmatches.json.

## Sprint 14.6 — captura visible y clasificación del visor — 2026-10-09

Se inspeccionó una muestra estratificada de 16 fichas distribuidas entre 1996 y 2026 y varias Salas, usando la navegación visible de la ficha y el visor oficial. Resultado comprobado:

| Estado de la muestra | Cantidad | Evidencia |
|---|---:|---|
| PDF guardado desde Edge y firma `%PDF-` válida | 12 | Bytes, SHA-256 y archivo local verificados |
| Documento no disponible en el visor | 2 | `notFoundDocument.seam`; página HTML visible con “No posee permisos suficientes para acceder al documento” y “No es posible acceder al documento solicitado” |
| PDF real renderizado, guardado aún no validado | 2 | Visor muestra el documento y permite leer expediente, Sala y carátula; sin archivo descargado todavía |

Las dos fichas `DOCUMENT_UNAVAILABLE` corresponden a 2012 y 2013. No mostraron CAPTCHA, login ni challenge. No se las reclasifica como intervención humana requerida.

En las respuestas que Playwright expone como `200 application/pdf`, el cuerpo de 348 bytes es una envoltura HTML sintética del visor de Edge con `<embed ... src='about:blank' type='application/pdf'>`, sin firma `%PDF-`. No es el cuerpo original del PDF ni evidencia de documento faltante. Los PDFs válidos se guardan sólo después de validar `%PDF-`, tamaño y SHA-256. Además, tras abrir el enlace visible se probó una única petición autenticada en el mismo contexto a esa URL exacta observada: para 2024/K, expte. 100913/2019, respondió `200 application/pdf`, 452.910 bytes y firma `%PDF-` válida; no fue necesario inventar ni alterar la URL. El checkpoint separa bytes del wrapper del navegador (`browser_wrapper_bytes`, 348) y bytes de la respuesta/visor (`viewer_body_bytes`, 452.910). Un control conocido de 2026 (Sala M, expte. 18717/2023) dio 196.746 bytes y el mismo SHA-256 que el checkpoint verificado: `28b2461bee77f49c707debfe87144515ab272083fd1ae75e82ea472eff77f4c9`.

En la inspección de identidad se detectaron conflictos que impiden ingestión automática: las fichas 1996/K (expte. 76448/1991) y 2000/F (expte. 104941/1994) produjeron el mismo SHA-256, cuyo PDF interno identifica otro caso de Sala A de 2015; 2016/L (expte. 28520/2011) produjo un PDF que indica expte. 25.520/11. Esos PDFs son recuperables desde el visor, pero su correspondencia queda `REVIEW_REQUIRED`; SHA coincidente no sustituye el cotejo de expediente, Sala, fecha y carátula. Las fichas 2022/A (Serebrinsky, 101078/2011) y 2024/K (Rome, 100913/2019) sí muestran PDFs legibles que concuerdan visualmente con su ficha; falta validar bytes y firma mediante guardado local.

El checkpoint incremental está en `_recovery-work/sprint146/viewer/viewer-recovery.sqlite`; los objetos PDF válidos por contenido están en `_recovery-work/sprint146/viewer/objects/`. Guarda fecha, año, Sala, expediente, status HTTP, MIME, URL final redactada, bytes del wrapper, bytes descargados, firma PDF, SHA-256, mensaje y clasificación. No se importó ningún PDF de Sprint 14.6 ni se modificaron Corpus, Search o PostgreSQL.

**Corte final de Sprint 14.6, actualizado en Sprint 14.7:** el checkpoint clasificó **5.738/10.600** enlaces: **5.710 PDFs con firma válida**, **10 `DOCUMENT_UNAVAILABLE`**, **18 `VIEWER_ERROR`** y **4.862 sin procesar**. Los errores no se cuentan como documentos no disponibles. Los PDFs recuperados suman filas de enlace; la deduplicación por SHA se conserva en el checkpoint. La cola quedó detenida cuando PJN exigió “VER DESAFÍO” repetidamente, y Sprint 14.7 retiró el visor de la ruta masiva. No se sortearon controles ni se construyeron URLs alternativas.



## Sprint 14.7 — recuperación alternativa de enlaces dinámicos — 2026-10-10

### Punto de partida y manifest

Se preservó `sprint146/viewer/viewer-recovery.sqlite` y se cerró la cola de navegación que exige CAPTCHA por documento con estado operativo `CAPTCHA_PER_DOCUMENT_NOT_SCALABLE`. No se volvió a consultar el visor ni se descargaron de nuevo los 5.710 PDFs verificados.

El cruce entre Cuantificación y el checkpoint confirmó **10.600** enlaces dinámicos: **5.710 `PDF_ACCESSIBLE`**, **10 `DOCUMENT_UNAVAILABLE`**, **18 `VIEWER_ERROR`** y **4.862 sin procesar**. El manifest de Sprint 14.7 consolida los **4.890** casos abiertos (pendientes + errores + no disponibles), con ID de Cuantificación, ID externo, expediente, carátula, Sala, tribunal, fecha/año, URL de ficha, URL del visor conocida, clasificación anterior, causa y posibles matches. Ruta local: `_recovery-work/sprint147/missing-manifest.jsonl`; resumen y checkpoint de estado: `_recovery-work/sprint147/missing-manifest-summary.json`.

Se preparó una muestra diagnóstica de 50: los 18 errores, los 10 no disponibles y 22 pendientes elegidos por año. No se consultó esa muestra en sistemas que exigen login/CAPTCHA; se cotejó offline contra Corpus e histórico y se usó para registrar la viabilidad de las fuentes.

### Fuentes alternativas

- **Sistema de Jurisprudencia PJN:** el portal oficial enlaza a [sj.pjn.gov.ar/consulta](https://sj.pjn.gov.ar/consulta/). El HTML sirve una aplicación SPA; el JavaScript público declara `FORCE_LOGGIN=true`, `CAN_SHOW_FALLOS=false` y carga el cliente CAPTCHA institucional. La carga automatizada devolvió `Request Rejected`. No se enviaron búsquedas ni se intentó sortear el control; **0 expedientes consultados, 0 resultados y 0 documentos**. La ruta no habilita una búsqueda externa paginable en el estado observado.
- **Histórico CSJN/TFN:** crossmatch offline de los 4.890 faltantes contra las 1.277 fichas `CIVIL_EXACT` existentes; 8 candidatos, 0 `EXACT`/`HIGH_CONFIDENCE` y 0 PDFs locales utilizables asociados a esos candidatos. No se recrawleó el histórico.
- **Corpus BJC:** snapshot local protegido por el guard DEV, cotejado contra los 4.890 faltantes; 51 candidatos, 0 `EXACT`/`HIGH_CONFIDENCE` y 0 matches existentes confirmados. Los candidatos no se fusionaron.
- **CIJ:** 0 matches confirmables en la comparación previa. Se conservaron las restricciones ya documentadas para rutas de consulta/descarga; no se volvió a rastrear noticias ni se accedió a rutas disallow.
- **Buscador actual CSJN:** no se enviaron búsquedas nuevas. El corte operativo ya comprobado sigue mostrando un feed inicial acotado a 20 resultados, sin paginación visible; la búsqueda filtrada requiere `cap-widget` y los enlaces de descarga observados están bajo rutas disallow. No se construyeron IDs ni URLs.

El resultado de la muestra y del crossmatch no justifica un full run de esas rutas: el sistema PJN no permite la consulta externa normal, y las fuentes locales no produjeron matches fuertes ni PDFs alternativos. Los 51 + 8 candidatos se mantienen como candidatos, no como documentos recuperados.

### Corpus e indexación

No se recuperaron PDFs ni textos completos por fuentes alternativas y no se ejecutó ingesta. Corpus Civil DEV quedó en **1.474 documentos** antes y después; **delta 0**. Search V2 no cambió. La verificación bajo guard local `bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev` dio `PASS`: **12.482 documentos**, **10.391.916 tokens**, `stale=0`, 0 discrepancias en 100 documentos muestreados y ninguna persistencia de texto de consulta.

`pnpm civil:status` ahora agrega `CIVIL_ALTERNATIVE_RECOVERY` a la cobertura ya existente. Presenta los conteos del manifest, estado de cada fuente, matches y candidatos sin leer secretos ni modificar Corpus/Search.

### Cobertura anual observada

Los casos conocidos son conteos anuales del inventario de Cuantificación y pueden repetirse entre años si un expediente tiene fallos en más de un año; el total global deduplicado sigue siendo **14.142**. Los conteos de visor son filas de enlace, no SHA únicos. “Documentos en BJC” cuenta Corpus Civil de todas las fuentes, no sólo los expedientes de Cuantificación.

| Año | Casos únicos conocidos | PDF visor verificados | Pendientes alternativos | Error técnico | No disponibles | Documentos en BJC |
|---:|---:|---:|---:|---:|---:|---:|
| 1993 | 123 | 0 | 0 | 0 | 0 | 0 |
| 1994 | 142 | 0 | 0 | 0 | 0 | 0 |
| 1995 | 146 | 0 | 0 | 0 | 0 | 0 |
| 1996 | 150 | 1 | 0 | 0 | 0 | 0 |
| 1997 | 126 | 0 | 0 | 0 | 0 | 0 |
| 1998 | 132 | 0 | 0 | 0 | 0 | 0 |
| 1999 | 131 | 0 | 0 | 0 | 0 | 0 |
| 2000 | 161 | 1 | 0 | 0 | 0 | 0 |
| 2001 | 186 | 0 | 0 | 0 | 0 | 0 |
| 2002 | 223 | 0 | 0 | 0 | 0 | 0 |
| 2003 | 143 | 0 | 0 | 0 | 0 | 0 |
| 2004 | 161 | 0 | 0 | 0 | 0 | 1 |
| 2005 | 216 | 0 | 0 | 0 | 0 | 0 |
| 2006 | 264 | 0 | 0 | 0 | 0 | 0 |
| 2007 | 223 | 0 | 0 | 0 | 0 | 0 |
| 2008 | 187 | 0 | 0 | 0 | 0 | 1210 |
| 2009 | 230 | 0 | 0 | 0 | 0 | 2 |
| 2010 | 224 | 0 | 0 | 0 | 0 | 0 |
| 2011 | 238 | 0 | 0 | 0 | 0 | 0 |
| 2012 | 212 | 0 | 0 | 0 | 1 | 2 |
| 2013 | 239 | 2 | 0 | 0 | 3 | 42 |
| 2014 | 299 | 0 | 0 | 0 | 0 | 1 |
| 2015 | 363 | 243 | 0 | 0 | 0 | 11 |
| 2016 | 759 | 797 | 0 | 0 | 0 | 24 |
| 2017 | 757 | 791 | 0 | 1 | 0 | 34 |
| 2018 | 901 | 953 | 0 | 0 | 1 | 26 |
| 2019 | 996 | 1062 | 0 | 0 | 1 | 20 |
| 2020 | 512 | 552 | 0 | 0 | 0 | 12 |
| 2021 | 665 | 719 | 0 | 12 | 1 | 14 |
| 2022 | 1291 | 585 | 856 | 5 | 3 | 9 |
| 2023 | 1382 | 1 | 1516 | 0 | 0 | 21 |
| 2024 | 867 | 1 | 924 | 0 | 0 | 15 |
| 2025 | 875 | 1 | 909 | 0 | 0 | 13 |
| 2026 | 626 | 1 | 653 | 0 | 0 | 17 |
| UNKNOWN | 4 | 0 | 4 | 0 | 0 | 0 |

### Estado y KPI de cierre de Sprint 14.7

| Indicador | Resultado |
|---|---:|
| Casos Cámara Civil conocidos | 14.142 |
| Enlaces dinámicos | 10.600 |
| PDFs válidos recuperados desde el visor | 5.710 |
| Casos con documento confirmado en BJC (corte Sprint 14.5, sin cambio en esta misión) | 223 |
| Pendientes de otra fuente | 4.862 |
| Errores técnicos por revisar | 18 |
| Declarados no disponibles en el visor | 10 |
| Recuperados por fuentes alternativas en Sprint 14.7 | 0 |
| Candidatos de Corpus / histórico sin confirmar | 51 / 8 |
| Documentos en Corpus Civil DEV | 1.474 |
| Search V2: documentos / tokens / stale | 12.482 / 10.391.916 / 0 |

- **ALTERNATIVE RECOVERY:** `BLOCKED` para adquisición automatizable; 4.890 filas abiertas quedaron identificadas y cotejadas offline. La fuente PJN prioritaria exige login y expone CAPTCHA en su configuración pública; el acceso externo consultable de fallos aparece deshabilitado.
- **INGEST:** `PARTIAL`; no hubo documento alternativo nuevo para importar. Los 5.710 PDFs guardados en Sprint 14.6 siguen fuera del Corpus hasta un flujo de ingesta/cotejo posterior.
- **SEARCH:** `PASS`; verificación protegida sin rebuild, alteraciones ni regresión observada.
- **Siguiente gap comprobado:** una fuente oficial civil que permita buscar por expediente en una consulta externa paginable y revele de manera normal una referencia documental descargable. No reanudar la cola de 4.862 visor mientras requiera challenge por documento.

## Sprint 14.8 — consolidación offline y preflight inicial — 2026-10-10

Se reconstruyó un manifest SQLite/JSONL a partir del checkpoint local del visor, enlazando **5.710/5.710** `PDF_ACCESSIBLE` con su ficha exacta del checkpoint de Cuantificación. Se encontraron **5.050/5.050** objetos PDF físicos por SHA en `sprint146/viewer/objects`; faltantes **0**, inesperados **0**. Los objetos suman **1.434.557.099 bytes**; la suma de las referencias de origen es **1.644.170.171 bytes**. El parser offline abrió **5.049** objetos, con **105.074 páginas**; un objeto tiene firma y SHA consistentes pero `pdf-parse` no puede abrir su estructura, por lo que queda `INVALID_FILE`. Hay **5.050 SHA únicos**, **660 referencias repetidas** y máximo **8 fichas por SHA**.

La normalización enlazó todas las filas de visor con el checkpoint fuente y no detectó diferencias en expediente, Sala ni fecha entre ambos registros. El cruce offline fila a fila contra la instantánea de Corpus previa al sprint dio una clasificación provisional de **5.179 `NEW_DOCUMENT`**, **2 `EXACT_DOCUMENT_MATCH`**, **48 `SAME_DOCUMENT_DIFFERENT_FILE`**, **118 `CANDIDATE`**, **362 `CONFLICT`** y **1 `INVALID_FILE`**. Estos son estados de 5.710 source records, no altas de documentos jurídicos. La reconciliación interna normalizada agrupó esas fichas en **5.208 claves de documento jurídico**: **4.756 NEW_DOCUMENT**, **2 EXACT_DOCUMENT_MATCH**, **15 SAME_DOCUMENT_DIFFERENT_FILE**, **113 CANDIDATE**, **321 CONFLICT** y **1 INVALID_FILE**. Se hallaron **382 grupos de duplicados exactos** con **488 filas excedentes**; contando también 20 grupos de una misma clave jurídica con varias representaciones PDF, hay 402 grupos multirregistro y 502 filas excedentes. Máximo: 10 source records por clave. En 143 valores SHA se observó asociación con múltiples claves jurídicas; 291 grupos de `quantification_id` colisionan entre identidades distintas, por lo que ese ID no se usa como clave de fusión. Además, 18 grupos expediente/Sala tienen posibles fechas distintas y permanecen en revisión. Los conflictos y candidatos quedan fuera de la ingesta automática. `EXACT_FILE_MATCH` y los matches finales contra Corpus requieren PostgreSQL DEV vivo; ninguna cifra offline se presenta como confirmación de base.

**Estado al cierre de ese checkpoint (2026-10-10):** la ingesta y la actualización de Search aún no se habían ejecutado. PostgreSQL DEV estaba detenido y bloqueado por Code Integrity. Este bloqueo quedó resuelto durante la continuación Sprint 14.8 del 2026-10-13; véase el cierre efectivo a continuación.

### Cierre efectivo de Sprint 14.8 — 2026-10-13

- Entorno DEV confirmado: PostgreSQL 16.15, `127.0.0.1:55432`, `buscador_juridico_civil_dev`, rol `bjc_dev`, `pg_trgm 1.6`; migrate status 20/20 up to date. La base y todos los comandos de escritura se mantuvieron bajo el guard DEV. No se accedió a producción ni a servidores institucionales.
- Se creó y verificó backup antes de cualquier escritura; el manifiesto se preservó en `_recovery-work/sprint148/backup-before.json`. Después de las validaciones se creó el backup final: dump 569.973.502 bytes, SHA-256 `2ebf2ab34364e46cee818b1eec26a73e6a7e791f6ecd424e3b381204506309cf`; SQL 2.292.659.000 bytes, SHA-256 `b70c36f11017bf5fc2dd20120674480399840d0848b3862a78e50a9112537401`.
- Ingesta idempotente: 4.596 documentos nuevos, 160 documentos existentes vinculados, 5.176 registros de procedencia; 4.596 indexados, 93.563 páginas y 191.181.254 caracteres extraídos; cero OCR_REQUIRED/fallidos/inválidos. El dry-run repetido dio cero documentos/archivos/blobs nuevos y cero vínculos pendientes. Corpus Civil quedó en 6.070 (6.069 Cámara + 1 primera instancia).
- Los 452 grupos fuera del set seguro siguen retenidos para revisión: 328 conflictos, 106 candidatos, 15 mismo documento/archivo distinto, 2 coincidencias exactas de documento y 1 archivo inválido. Incluye cuatro muestras con discrepancias entre fechas fuente y firma PDF, marcadas para revisión de calidad; los metadatos fuente se preservan.
- Search proyección verificada: 17.078 documentos, 18.799.500 tokens, `stale=0`, 0 discrepancias/100, ready. Paridad 40/40 y viewer smoke 6/6. Suite backend 93 PASS/15 omitidos; PG 7/7; Corpus 3/3; paquete Corpus 2/2; typecheck/build y migraciones PASS.
- Search queda `REGRESSION` para PHRASE: p50/p95 1.710,58/2.621,10 ms frente a 270/538 ms en el corte anterior. La evidencia EXPLAIN muestra lecturas de heap extensas en formas de frase. Diagnosticar y optimizar esta ruta es el siguiente paso antes de reabrir la cola masiva.
- En el corte de cierre inicial de Sprint 14.8, el backlog Sprint 14.7 se reportó como 4.862 pendientes, 18 errores técnicos y 10 no disponibles (4.890 filas abiertas). Esa clasificación quedó supersedida por la revisión posterior del visor documentada abajo: 17 challenges humanos y 1 error de visor.

### Checkpoint vigente del visor histórico y discovery profundo — 2026-10-13

Se reconcilió `_recovery-work/sprint146/viewer/viewer-recovery.sqlite` (read-only) con las 10.600 filas del universo temático. El conteo vigente reemplaza el checkpoint anterior; no implica que las filas no intentadas compartan el resultado de las muestras.

| Clasificación observada | Filas | Evidencia |
|---|---:|---|
| `PDF_ACCESSIBLE` | 5.710 | 5.050 objetos SHA únicos: 5.049 con firma PDF y parseo válidos; 1 con firma válida pero estructuralmente inválido. Total 105.074 páginas en el conjunto descargado. |
| `DOCUMENT_UNAVAILABLE` | 10 | Ruta final `notFoundDocument.seam`, HTTP 200 y `text/html`; 8 filas guardan «No es posible acceder al documento solicitado». Ninguna tiene firma PDF. |
| `HUMAN_CHALLENGE_REQUIRED` | 17 | Respuestas HTML con widget PJN visible y texto «VER DESAFÍO: Presione el botón y resuelva el desafío». No se sorteó el challenge. |
| `VIEWER_ERROR` | 1 | 2017/K, expediente 91580/2007: visor modal vacío sin respuesta de documento. No se reclasifica como indisponibilidad. |
| Sin intento | 4.862 | Estado desconocido; no se extrapola desde la muestra ni se ejecutó una descarga masiva en esta auditoría. |

Los 452 grupos de identidad retenidos para revisión corresponden a 328 conflictos, 106 candidatos, 15 pares con misma identidad legal y archivo distinto, 2 coincidencias exactas de documento y 1 archivo inválido. No se fusionan automáticamente. Entre los 4.890 enlaces abiertos del análisis histórico, 4.862 no tienen intento, 17 requieren challenge, 10 reportan documento no disponible y 1 es error técnico del visor.

El universo de origen es una base temática Civil, no un censo de todas las sentencias: 15.478 filas de resultados en 10 temas, 12.819 IDs de portal, 14.142 números de expediente distintos y 14.154 grupos expediente-año. Se conciliaron 4.758 claves seguras del set de visor con Corpus (4.756 claves de archivo exacto y 2 coincidencias exactas de documento). El 33,6% sólo representa una cuota inferior de ese universo temático; no es cobertura total de Galilei.

El snapshot DEV actual contiene 17.078 documentos generales y 6.070 identificados como Civil por metadata judicial; 6.069 llevan Cámara Civil y 1 Juzgado Civil 64. Sólo 1.473 tienen `SECOND_INSTANCE` explícito y 1 tiene `FIRST_INSTANCE`; 4.596 importaciones recientes tienen la corte Cámara Civil pero `instance` sin completar. No se deben reinterpretar los 109 nombres de juzgados de origen en metadata de fallos de Cámara como sentencias publicadas de primera instancia.

La auditoría de 20 PDFs locales —12 Salas y 13 años representados— dio 20 firmas válidas, 20 documentos con texto extraíble, 476 páginas en total y cero archivos rotos o imagen-only en la muestra. No es una validación de calidad para los 5.049 PDFs válidos. Los artefactos reproducibles están en `_recovery-work/jurisprudencia-discovery/` y permanecen ignorados por Git.

**Estado de adquisición:** la clasificación histórica permanece parcial. Aún no se conoce el total oficial canónico de jurisprudencia Civil disponible; no hay porcentaje global de cobertura. Los próximos pasos son obtener un inventario/export autorizado y una ruta documental normal para primera instancia, después revisar los 452 grupos, y sólo entonces cuantificar de manera permitida los 4.862 enlaces sin intento. No iniciar descarga masiva ni resolver desafíos automáticamente.

## Sprint J1 — reconciliación Civil + clasificación + coverage (2026-10-13)

El auditado de DEV confirmó 17.078 documentos Corpus, de los cuales 6.070 son Civil (6.069 Cámara y 1 Juzgado Civil 64). Los 4.596 sin instancia tenían en `metadataOriginal` del ingreso la corte exacta `Cámara Nacional de Apelaciones en lo Civil` y Sala explícita A–M, siempre desde `CIVIL_CUANTIFICACION_DANOS`. Con esa evidencia determinística se actualizaron 4.596 campos `instance=SECOND_INSTANCE`, sin cambiar texto, PDF, `metadataOriginal` ni tokens. El resultado es 6.069 `SECOND_INSTANCE`, 1 `FIRST_INSTANCE` y 0 Civil sin instancia. La verificación Search mantuvo 17.078 documentos, 18.799.500 tokens, stale=0 y 0 mismatches/100; la misma operación repetida omitió 4.596 y actualizó 0.

De los 452 grupos retenidos, la reclasificación deja 328 conflictos agrupados por seis combinaciones de causa, 106 candidatos en revisión, 15 identidades legales con SHA distinto, 2 matches de identidad jurídica con SHA distinto y 1 PDF corrupto rechazado. No se realizó ninguna fusión ni asociación sobre esos grupos: los dos matches comparten expediente, tribunal, Sala y fecha, pero sus SHA difieren, no hay fila `Sentencia` de destino y el enlace de ingesta existente exige SHA idéntico. La exportación humana contiene los 451 grupos no rechazados; el PDF inválido comienza con `%PDF-`, carece de `%%EOF` y el parser devuelve `Invalid PDF structure.`

El coverage engine reutilizable es `JurisprudenciaN/back/scripts/dev/jurisprudencia-coverage.cjs`; acepta CSV/JSON de censo con portalId, expediente, año, Sala/Juzgado, fecha, URL y estado de match. Snapshot actual: 14.154 grupos expediente-año del universo temático conocido; 4.758 PDFs adquiridos tienen clave segura, de los cuales 4.756 enlazan por SHA exacto con Corpus y 2 tienen sólo identidad jurídica alta y quedan sin vínculo por SHA distinto. El match efectivo Corpus/set conocido es 4.756 (33,6% **dentro de ese set temático**), sin inferencia de cobertura Civil total. Los cortes por año, Sala, instancia y órgano están en `_recovery-work/jurisprudencia-j1/`; estos artefactos y backups permanecen excluidos de Git. Estado J1: **PARTIAL**, porque 451 grupos siguen pendientes de revisión o de un contrato de asociación compatible.

## Sprint J2 — primera instancia y canal de censo (2026-10-14)

La página oficial del buscador CSJN Tribunales Federales y Nacionales expone filtros por jurisdicción, expediente, Cámara, tipo de oficina/tribunal, carátula, palabras clave y fecha; sus resultados incluyen acciones «Descargar» y «Ver Fallo». La instrucción pública fija el inicio visible desde 21/08/2013 y deriva los anteriores a otra consulta. El Consejo informó el 05/09/2025 que se añadieron sentencias de primera instancia conforme Acordada 10/2025. Esto confirma una vía pública de consulta, no la exhaustividad del universo Civil ni un censo/export completo. No se halló documentación oficial revisada de export CSV/JSON, ID estable, paginación total o permiso de automatización; adquisición piloto: 0 documentos hasta recibir un mecanismo autorizado.

Fuentes revisadas el 14/10/2026: [buscador oficial CSJN](https://www.csjn.gov.ar/tribunales-federales-nacionales/inicio.html), [informe oficial del Consejo sobre primera instancia](https://consejomagistratura.gov.ar/index.php/2025/09/05/la-corte-suprema-amplia-el-acceso-a-las-decisiones-judiciales/) y [portal oficial PJN](https://pjn.gov.ar/). El archivo CIJ quedó sólo como repositorio histórico, no como denominador ni ruta automatizable.

Se preparó `_recovery-work/jurisprudencia-j2/authorized-export-request.md`; no se envió. Solicita alcance/rango y exclusiones, conteos por año y juzgado, ID estable, expediente y año separado de fecha/año de decisión, órgano, carátula, tipo de resolución, metadata/document URL, disponibilidad, condiciones de reutilización y permiso de automatización. El censo futuro usa el importador local CSV/JSON en modo read-only por defecto; ningún URL se descarga desde el importador.

## Sprint J3 — preparación del intake autorizado (2026-10-14)

Pipeline de recepción local listo en `JurisprudenciaN/back/scripts/dev/first-instance/intake.cjs`: CSV UTF-8 (coma o punto y coma), JSON y NDJSON; mapping explícito; validación por fila; preservación de la fila original; clasificación de Cámara/otros fueros/órganos desconocidos; duplicados de ID idénticos o conflictivos; posibles duplicados de identidad legal; hashes SHA-256 de origen/snapshot; conciliación read-only; funnel limitado a `coverage within supplied authorized census`; y manifiesto P0–P3 sin solicitudes ni descargas. XLSX debe exportarse a CSV UTF-8. Los archivos recibidos y runs quedan bajo `_recovery-work/authorized-exports/`, ignorados por Git.

Se completó un paquete de solicitud técnica/email/schema/ejemplo/README en `_recovery-work/jurisprudencia-j3/request-pack/`; permanece sin enviar y el destinatario está como placeholder. El export no fue recibido. Completeness sigue `UNKNOWN`; la única fila local de primera instancia sirvió para smoke EXACT sobre DEV read-only. Ninguna ruta automatizada de adquisición queda habilitada por este pipeline. Próxima etapa, si llega el archivo: J3.1 — intake real, conciliación y gaps dentro del alcance declarado, todavía sin descargas masivas.

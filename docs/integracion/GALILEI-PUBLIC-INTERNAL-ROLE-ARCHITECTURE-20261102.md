# Galilei y Jurisprudencia Civil — arquitectura pública e interna

Fecha de revisión del código: 2 de noviembre de 2026. Este documento describe el contrato que implementa el candidate actual. Los tests automáticos locales verifican rutas, permisos declarados y la allowlist pública; la prueba con una cuenta beta real y la validación del runtime quedan registradas separadamente en el cierre de la misión.

## Producto público

`/` es la entrada de **Jurisprudencia Civil**, con la identidad institucional de la Cámara Nacional de Apelaciones en lo Civil. `/consulta`, los detalles de Fallo y Sumario, los enlaces compartidos y el PDF conservan sus URLs existentes. La persona anónima puede abrirlos, actualizarlos y navegar hacia atrás y adelante. El header público sólo ofrece la marca institucional y el enlace secundario **Acceso interno** hacia `/login`.

El shell público no monta el menú de Galilei ni presenta Mi Sala/Juzgado, Mis documentos, Revisión, OCR, Registros, Usuarios o herramientas de administración. Los visores públicos inmersivos conservan el espacio completo de lectura y muestran la marca Jurisprudencia Civil en sus metadatos/título.

El backend público consulta la misma base, Search y storage. Para sentencias aplica `publicado=true` y `activo=true`; el PDF público requiere una sentencia publicada/activa y un PDF real asociado. El acceso público a Corpus usa el mismo servicio de ACL con alcance `PUBLIC`. Los documentos `INTERNAL`, `RESTRICTED`, privados, borradores sin publicar y páginas de revisión OCR no pasan esas condiciones.

## Galilei interno

Galilei requiere sesión. `/login` es el acceso interno; después del login la aplicación lleva a `/galilei`. El shell interno contiene la sesión, la navegación de trabajo y las herramientas habilitadas por rol. La búsqueda interna usa `/busqueda-avanzada`, los componentes compartidos `BusquedaJurisprudenciaForm` y `ResultadosJurisprudencia`, y el endpoint autenticado `/api/busqueda/avanzada`; no mantiene una segunda implementación de Search.

Las rutas internas fuera del grupo `(admin)` —por ejemplo `/evolucion/guardada/:id`— también se montan bajo el shell interno. La pantalla `/jurisprudencia/ingreso` conserva su circuito separado de ingreso. La navegación del shell oculta Panel para roles ajenos a Administración/Operación, Registros y Usuarios para roles no ADMIN, e Ingreso para roles que no pueden escribir en el flujo.

No se crean bases, índices, corpus ni copias de PDF separados. Tampoco se cambia el esquema ni se ejecutan migraciones para separar los productos.

## Roles reales

Los nombres de rol global que existen en `server/src/auth/constants.ts` son:

| Rol global | Función que permiten los guards actuales |
| --- | --- |
| `ADMIN` | Administración global; herramientas de operación; acceso interno ampliado. La administración global no concede membresía automática a una Sala/Juzgado o documento privado. |
| `OPERADOR` | Operación, Panel, estadísticas, revisión operativa y flujos editoriales que admiten este rol. |
| `LECTOR` | Consulta autenticada; acceso personal y documental sólo según endpoint y ACL. No puede usar endpoints editoriales que limitan el controller a ADMIN/OPERADOR/JURISPRUDENCIA. |
| `REVISOR` | Revisión de clasificaciones/asociaciones, citas candidatas y OCR; lectura del ingreso. No puede crear/editar sentencias mediante `SentenciasController` ni escribir metadata de ingreso. |
| `JURISPRUDENCIA` | Ingreso editorial, creación y edición de sentencias/sumarios, revisión de clasificación/asociación/citas y OCR, con las diferencias de publicación indicadas abajo. |
| `DIGESTO` | Herramientas y curaduría de Digesto que habilitan sus guards; consulta general autenticada según los endpoints comunes. |

`WorkspaceRole` es un permiso distinto, ligado a una membresía concreta: `ADMIN`, `EDITOR` o `VIEWER`. No es un rol global. `VIEWER` permite consulta dentro de la dependencia asignada; `EDITOR` habilita las operaciones editoriales del espacio; `ADMIN` habilita además su administración. El backend valida la membresía y ACL por documento antes de listar, contar, mostrar metadata, abrir el Viewer o descargar. Un rol global `ADMIN` no salta ese control.

### Matriz de rutas principales

`ALLOW` indica acceso a la ruta; `REDIRECT_LOGIN`, que la ruta requiere autenticación; `CONDITIONAL`, que depende de una membresía, estado o acción específica; `DENY`, que el perfil no tiene el acceso descrito. “Dep. Viewer/Editor” representa el rol de membresía, no un rol global; también se requiere una cuenta autenticada con un rol global existente.

| Ruta | Anónimo | Admin | Jurisprudencia | Revisor | Dep. Viewer | Dep. Editor |
| --- | --- | --- | --- | --- | --- | --- |
| `/`, `/consulta`, `/fallos/:slug`, `/consulta/sentencia/:slug`, PDF público | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |
| `/login` | ALLOW | REDIRECT_LOGIN si ya inició sesión | REDIRECT_LOGIN si ya inició sesión | REDIRECT_LOGIN si ya inició sesión | REDIRECT_LOGIN si ya inició sesión | REDIRECT_LOGIN si ya inició sesión |
| `/galilei` | REDIRECT_LOGIN | ALLOW | ALLOW | ALLOW | CONDITIONAL: requiere sesión | CONDITIONAL: requiere sesión |
| `/busqueda-avanzada` | REDIRECT_LOGIN | ALLOW | ALLOW | ALLOW | CONDITIONAL: requiere sesión | CONDITIONAL: requiere sesión |
| `/sentencias`, `/sumarios` y detalle interno | REDIRECT_LOGIN | ALLOW | ALLOW | DENY | DENY por rol global | DENY por rol global |
| `/jurisprudencia/ingreso` | REDIRECT_LOGIN | ALLOW | ALLOW | CONDITIONAL: consulta/lectura; escritura denegada | DENY por rol global | DENY por rol global |
| `/revision`, `/citas-pendientes` | REDIRECT_LOGIN | ALLOW | ALLOW | ALLOW | DENY por rol global | DENY por rol global |
| `/admin/jurisprudencia/ocr` | REDIRECT_LOGIN | ALLOW | ALLOW | ALLOW | DENY por rol global | DENY por rol global |
| `/corpus`, `/documentos` | REDIRECT_LOGIN | ALLOW | ALLOW | ALLOW | DENY por rol global | DENY por rol global |
| `/spaces`, `/spaces/manage`, Viewer de documento | REDIRECT_LOGIN | CONDITIONAL: membresía/ACL | CONDITIONAL: membresía/ACL | CONDITIONAL: membresía/ACL | CONDITIONAL: sólo la dependencia y permisos asignados | CONDITIONAL: misma ACL más acciones EDITOR |
| `/personal` | REDIRECT_LOGIN | ALLOW: propios | ALLOW: propios | ALLOW: propios | ALLOW: propios | ALLOW: propios |
| `/colecciones`, `/evolucion/guardada/:id` | REDIRECT_LOGIN | ALLOW | ALLOW | ALLOW | CONDITIONAL: requiere sesión | CONDITIONAL: requiere sesión |
| `/comparar` | ALLOW: resolución pública | ALLOW; guardar notas requiere sesión | ALLOW; guardar notas requiere sesión | ALLOW; guardar notas requiere sesión | CONDITIONAL: sólo datos propios con sesión | CONDITIONAL: sólo datos propios con sesión |
| `/dashboard`, `/estadisticas` | REDIRECT_LOGIN | ALLOW | DENY | DENY | DENY por rol global | DENY por rol global |
| `/admin/usuarios`, `/admin/logs` | REDIRECT_LOGIN | ALLOW | DENY | DENY | DENY por rol global | DENY por rol global |
| `/archivos`, `/favoritos`, `/busquedas-guardadas`, `/institutos-juridicos`, `/normas` | REDIRECT_LOGIN | ALLOW | DENY | DENY | DENY por rol global | DENY por rol global |

El alias `/jurisprudencia` lleva a la búsqueda interna; no reemplaza `/consulta`. La ruta pública `/comparar` y el resolvedor público de evolución muestran sólo fallos públicos. Guardar o abrir material propio requiere sesión.

### Matriz de capacidades editoriales reales

`CONDITIONAL` refleja un límite por estado, asignación o entidad. En la columna pública se evalúa acceso anónimo, sin sesión.

| Acción | Público | Jurisprudencia | Revisor | Admin |
| --- | --- | --- | --- | --- |
| Buscar contenido publicado | ALLOW | ALLOW | ALLOW | ALLOW |
| Ver Fallo publicado | ALLOW | ALLOW | ALLOW | ALLOW |
| Ver Sumario publicado | ALLOW | ALLOW | ALLOW | ALLOW |
| Ver PDF público | ALLOW: sólo PDF de Fallo publicado y activo | ALLOW | ALLOW | ALLOW |
| Buscar/ver borrador o contenido no publicado | DENY | ALLOW: Search interno y endpoints editoriales autorizados | CONDITIONAL: Search interno puede incluir contenido activo; `/sentencias` y `/sumarios` están denegados | ALLOW |
| Crear Fallo | DENY | ALLOW: nace como borrador/no publicado | DENY | ALLOW: nace como borrador/no publicado |
| Editar Fallo | DENY | ALLOW: metadata; el PATCH genérico no altera `publicado`, `activo` ni `estadoCarga` | DENY | ALLOW |
| Editar Sumario | DENY | ALLOW: metadata; la publicación usa otro endpoint | DENY | ALLOW |
| Asociar Sumario ↔ Fallo | DENY | ALLOW al crear/editar Sumario o desde ingreso | DENY: la revisión de asociaciones Corpus no cambia esta relación jurídica | ALLOW |
| Ingreso PDF → procesamiento → metadata → coincidencia → borrador | DENY | CONDITIONAL: puede ejecutar el flujo; sujeto a validez del archivo y al estado del ingreso | CONDITIONAL: sólo lectura; no puede escribir metadata, vincular, crear borrador, cancelar ni reintentar | CONDITIONAL: flujo permitido sujeto a validaciones de archivo y estado |
| Revisión editorial | DENY | ALLOW: clasificación, asociaciones documentales y citas candidatas según estado | ALLOW: asociaciones/clasificaciones habilitadas y citas candidatas; no equivale a edición de Fallos/Sumarios | ALLOW |
| Citas | DENY | ALLOW: consulta y revisión de citas candidatas; DENY para CRUD manual `CitaFallo` | ALLOW: consulta y revisión de citas candidatas; DENY para CRUD manual `CitaFallo` | CONDITIONAL: candidatas y citas manuales; el DELETE manual borra la fila y deja auditoría |
| Ver cola OCR, PDF original, texto reconocido/corregido y estado | DENY | CONDITIONAL: review elegible y accesible | CONDITIONAL: review elegible y accesible | CONDITIONAL: review elegible y accesible |
| Corregir texto OCR | DENY | CONDITIONAL: review editable, asignación/actor y versión válidos | CONDITIONAL: mismas reglas de asignación, estado y versión | CONDITIONAL: puede intervenir en reviews asignados a otra persona; sujeto a estado/versión |
| Aprobar/rechazar páginas u OCR | DENY | CONDITIONAL: acciones del endpoint y estado permiten al actor; no publica Fallo/Sumario | CONDITIONAL: acciones habilitadas, estado, asignación y versión válidos | CONDITIONAL: acciones habilitadas y estado/versión válidos |
| Publicar Fallo / Sumario | DENY | CONDITIONAL: ALLOW para Fallo; DENY para Sumario | DENY | ALLOW para ambos |
| Despublicar Fallo / Sumario | DENY | CONDITIONAL: ALLOW para Fallo; DENY para Sumario | DENY | ALLOW para ambos |
| Archivar Fallo / Sumario | DENY | CONDITIONAL: ALLOW para Fallo; Sumario no tiene acción de archivo para este rol | DENY | CONDITIONAL: Fallo se archiva; Sumario se da de baja lógica por su DELETE |
| Eliminar Fallo / Sumario / PDF | DENY | DENY para DELETE; el rol sí puede archivar/despublicar Fallo según estado | DENY | CONDITIONAL: Fallo `DELETE` llama a archive; Sumario `DELETE` lo marca inactivo; PDF devuelve 409 y conserva original |
| Ver Auditoría | DENY | DENY | DENY | ALLOW |

La tabla conserva las reglas de los controllers: `SentenciasController` permite ADMIN/OPERADOR/JURISPRUDENCIA; `SumariosController` usa los mismos roles para creación/edición, pero sus endpoints de publicación permiten sólo ADMIN/OPERADOR. Revisor y Jurisprudencia comparten algunas colas, no todas las acciones. Los permisos de OCR y revisión se limitan además por la elegibilidad, el estado, la asignación y las versiones optimistas. La administración global no reemplaza la membresía de Workspace ni la ACL del documento.

### Categorías de Revisión y diferencia entre perfiles

La pantalla `Revisión` expone las categorías vigentes del código: **Asociaciones**, **Temas sugeridos**, **OCR pendiente**, **Fuente faltante**, **Errores** y **Metadatos**. Jurisprudencia y Revisor pueden abrir la cola y los detalles documentales permitidos. En Asociaciones ambos pueden aprobar/rechazar la sugerencia; en Temas sugeridos ambos pueden revisar, editar la clasificación y aprobar/rechazar, con auditoría. Las cuatro categorías restantes son filtros/colas de seguimiento y enlazan al documento Corpus; la pantalla no ofrece en esos filtros una aprobación editorial genérica.

La curaduría específica de Jurisprudencia es distinta: cambiar el estado editorial del documento a `REVIEW_PENDING`, `SELECTED` o `NOT_SELECTED`, incluida la selección por lote, sólo admite ADMIN/OPERADOR/JURISPRUDENCIA. Revisor no puede ejecutar esa decisión de publicación/selección. En Ingreso institucional Revisor puede consultar trabajos y estados, pero no subir el PDF, modificar metadata, vincularlo, crear el borrador, cancelar ni reintentar extracción; Jurisprudencia sí puede ejecutar esas acciones mientras el estado del ingreso las permita.

En Citas, ambos perfiles pueden consultar, detectar y resolver candidatos; una relación sólo pasa a la vista pública cuando queda verificada y los fallos relacionados son públicos y activos. La edición manual de `CitaFallo` es un flujo separado, permitido a ADMIN/OPERADOR; su DELETE físico registra auditoría. La navegación a un Fallo/Sumario no confiere permisos para editar o publicar esa entidad.

En OCR, Jurisprudencia y Revisor pueden abrir reviews elegibles, consultar PDF/textos, tomar una revisión no asignada, corregir páginas, marcar estado y aprobar/rechazar de acuerdo con las rutas existentes. Si la revisión está asignada a otra persona, sólo ADMIN/OPERADOR pueden intervenir; los cambios además deben coincidir con el estado y la versión esperada. Aprobar OCR promueve páginas aprobadas al Corpus/Search interno, pero no publica un Fallo ni un Sumario. Diagnóstico del runtime y verificación efímera del motor son sólo ADMIN.

## CRUD y política de retiro

| Entidad/acción | Implementación actual |
| --- | --- |
| Fallo: CREATE | `POST /api/sentencias` y los flujos completos fuerzan `publicado=false`, `activo=true`, `estadoCarga=BORRADOR`. El ingreso institucional también crea un borrador sin publicar. |
| Fallo: READ | `GET /api/sentencias*` requiere sesión y rol ADMIN/OPERADOR/JURISPRUDENCIA; `/api/public/sentencias/:slug` filtra publicado y activo. |
| Fallo: UPDATE | `PATCH /api/sentencias/:id` actualiza metadata y elimina del DTO `publicado`, `activo` y `estadoCarga`; los cambios editoriales de estado usan endpoints específicos. |
| Fallo: DELETE / ARCHIVE / UNPUBLISH | `PATCH /:id/archivar` es una baja lógica: `publicado=false`, `activo=false`, `estadoCarga=ARCHIVADA`, retiro del alcance público y del Search público; conserva registro, historial, PDF y blob. `PATCH /:id/despublicar` quita publicación sin archivar. `DELETE /:id` sólo ADMIN y llama a `archive()`; no borra físicamente. |
| Sumario: CREATE / UPDATE | Sesión y ADMIN/OPERADOR/JURISPRUDENCIA. La relación al Fallo se mantiene mediante `sentenciaId`. |
| Sumario: DELETE | `DELETE /api/sumarios/:id` sólo ADMIN; ejecuta `activo=false` y registra auditoría. Es baja lógica, no `DELETE` físico. Publicación/despublicación sólo ADMIN/OPERADOR. |
| PDF de jurisprudencia: DELETE | Aunque la ruta administrativa `DELETE /api/archivos/:id` existe para ADMIN, el servicio responde `409 Conflict` y conserva metadata y archivo para proteger procedencia. Archivar/despublicar el Fallo lo retira de la consulta pública sin borrar el original. |
| Ingreso institucional: CANCEL | Cambia el estado a `CANCELLED` y agrega evento/auditoría. No borra el PDF ni permite cancelar un ingreso ya vinculado o con borrador creado. |
| Cita candidata | `VERIFIED`, `REJECTED` o `UNRESOLVED` son estados revisables; rechazar no elimina físicamente el historial. Sólo una relación verificada entre Fallos publicados/activos se expone públicamente. |
| Cita manual | El `DELETE /api/citas-fallo/:id` permitido a ADMIN/OPERADOR elimina la fila y registra evento de auditoría. No forma parte del permiso de JURISPRUDENCIA ni REVISOR. |
| OCR | No hay endpoint de borrado de revisión/páginas. Se conserva PDF original; correcciones, aprobaciones y reaperturas agregan revisiones/auditoría y control de versión. Aprobar páginas/documento habilita el flujo Corpus/Search interno; no publica por sí solo un Fallo ni un Sumario. |

No hay endpoint de borrado separado para un borrador de Fallo: se archiva con la política de sentencia. No se cambió ninguna de estas reglas.

## API pública allowlist

El `JwtAuthGuard` está instalado globalmente por `AppModule`; `RolesGuard` aplica los roles declarados. Sólo las rutas anotadas con `@Public` saltan autenticación. La siguiente allowlist refleja controllers/decorators actuales:

| Método y rutas | Uso y límite |
| --- | --- |
| `GET /api/public/busqueda`, `/busqueda/interpretacion`, `/busqueda/sugerencias`, `/busqueda/temas`, `/busqueda/salas`, `/busqueda/tipos-fallo` | Search público, sugerencias y filtros publicados; `publicado=true`, `activo=true`, sólo fuente Jurisprudencia. |
| `GET /api/public/sentencias/recientes`, `/mas-recientes`, `/:slug`, `/:slug/ficha`, `/:slug/documento`, `/:slug/cita`, `/:slug/citas`, `/:slug/estructura`, `/:slug/relacionados`, `/:slug/mismo-expediente`, `/:slug/relaciones-verificadas` | Lectura de fallos publicados/activos y relaciones verificadas públicas. |
| `GET /api/public/sentencias/:slug/pdf` | PDF principal sólo de sentencia publicada/activa con archivo real asociado. |
| `GET /api/public/corpus/documents/:id`, `/:id/structure`, `/:id/file` | Sólo el servicio de acceso con visibilidad `PUBLIC`; no da acceso al Scope `PRIVATE_WORKSPACE` ni documentos internos/restringidos. |
| `GET /api/catalogos/salas`, `/tipos-fallo`, `/tribunales-origen` | Valores activos usados por filtros públicos; la ruta pública ignora `includeInactive` y no permite enumerar valores inactivos. |
| `GET /api/research/comparisons/resolve`; `POST /api/research/evolution/resolve` | Resolvedores de lectura sobre identificadores de Fallos públicos; el segundo usa POST por el cuerpo de la consulta, no persiste estado. |
| `POST /api/auth/login` | Inicio de sesión. No habilita recursos internos sin token/rol. |
| `POST /api/estadisticas/eventos/share-link`, `POST /api/public/eventos` | Excepciones de telemetría. Registran eventos acotados y no cambian Fallos, PDFs, workspaces, usuarios, OCR ni revisiones. |
| `GET /api/health`, `/api/health/live`, `/api/health/ready`, `GET /api/ia/health` | Probes operativos; no devuelven datos de usuario ni contenido jurídico. |

El resto de las operaciones de escritura sobre jurisprudencia, archivos, usuarios, workspaces, OCR, intake y revisión requieren sesión y las autorizaciones de controller/servicio. La regresión `server/src/auth/public-api-policy.spec.ts` exige que los únicos métodos públicos no-GET sigan siendo login, resolvedor no persistente y telemetría.

## API interna y datos compartidos

- `GET /api/busqueda/avanzada` acepta los seis roles globales. `ADMIN` busca con visibilidad `ADMIN`; los otros perfiles autenticados usan `INTERNAL`. La política interna admite registros activos no publicados que corresponden a trabajo editorial; no equivale a publicación pública.
- `/api/sentencias*` y `/api/sumarios*` restringen CRUD al conjunto de roles indicado en la matriz. Las acciones de publicación son endpoints separados.
- `/api/corpus/institutional-ingestions/*` permite lectura a ADMIN/OPERADOR/REVISOR/JURISPRUDENCIA; metadata, vínculo, creación de borrador, cancelación y retry sólo a ADMIN/OPERADOR/JURISPRUDENCIA.
- `/api/corpus/curation/*` separa lectura, revisión de asociaciones/clasificaciones, acciones de selección jurisprudencial y acciones Digesto con roles distintos.
- `/api/ocr-human-review/*` permite la cola/revisión a ADMIN/OPERADOR/REVISOR/JURISPRUDENCIA. Diagnósticos de motor y verificación en memoria son sólo ADMIN. Asignación, edición y aprobación además respetan el actor, estado/versionado, elegibilidad y asignación del review.
- `/api/research/citation-candidates/*` permite consultar/detectar/revisar candidatas a ADMIN/OPERADOR/JURISPRUDENCIA/REVISOR. Las citas manuales usan otro controller y otro permiso.
- `/api/logs/*`, `/api/usuarios/*`, `/api/roles/*` y controles administrativos quedan restringidos según su controller; logs, usuarios y roles son ADMIN.
- Workspaces, Corpus y documentos personales reutilizan la misma base y storage; los servicios aplican membership/propiedad/visibilidad antes de devolver conteos, datos, snippets o bytes.

## Seguridad y separación futura

La separación actual ocurre en rutas, marca, layout, autenticación y permisos; no divide procesos ni fuentes. Los filtros de publicación permanecen en los servicios de origen, no en la UI. La API pública tiene allowlist registrada en el test de política y las escrituras públicas que quedan fuera de dominio se justifican explícitamente arriba.

Una futura separación física puede extraer `PublicJurisprudenciaShell`, los DTO públicos y controllers públicos a un frontend/API de lectura, conservando contratos de publicación, PDF y ACL. La API interna mantendría Galilei, herramientas editoriales y datos de trabajo. Si se separa infraestructura, debe reutilizar una proyección de lectura autorizada y no duplicar corpus ni habilitar escrituras editoriales desde el proceso público. Esa separación física no está implementada aquí.

Para autenticación institucional futura, evaluar primero SSO OIDC/SAML respaldado por el proveedor institucional y aprovisionamiento JIT o sincronizado. LDAP/Active Directory sólo debe integrarse detrás de un servicio de identidad; evitar que el navegador consulte LDAP directamente. Mapear identidad externa a los roles globales ya existentes y preservar la membresía de Sala/Juzgado como autorización independiente. No se implementó SSO, AD ni LDAP en este cambio.

## Validación

- `PUBLIC_API_ALLOWLIST_TEST`: debe mantener sólo las cuatro operaciones públicas no-GET explícitas.
- Pruebas de UX anónima: portada, filtros, Sumario/Fallo/PDF, rutas directas/refresh, errores controlados y ausencia de navegación interna.
- Pruebas de URL privada anónima: cada ruta devuelve al login; acceso de API interno sigue bajo el guard JWT global.
- La matriz de cuentas beta reales y el runtime final deben verificarse en el cierre de deploy; este documento no afirma una aceptación UAT institucional.

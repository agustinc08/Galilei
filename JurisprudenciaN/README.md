# JurisprudenciaN

## Acceso para demo institucional

Local:

- Frontend: `http://localhost:4001`
- Backend: `http://localhost:4001/api`

LAN:

- Frontend: `http://10.5.3.138:4001`
- Backend: `http://10.5.3.138:4001/api`

Configuración a recordar:

- `front/next.config.ts` debe incluir `allowedDevOrigins` para la IP LAN usada en la demo.
- En backend, configurar `FRONTEND_URLS=http://localhost:4001,http://10.5.3.138:4001`.
- En frontend, configurar `NEXT_PUBLIC_API_URL` según el modo:
  - Local: `NEXT_PUBLIC_API_URL=http://localhost:4001/api`
  - LAN: `NEXT_PUBLIC_API_URL=http://10.5.3.138:4001/api`

Guía de presentación: ver `DEMO_INSTITUCIONAL.md`.

Sistema de gestion y consulta de jurisprudencia civil con:

- `back/`: NestJS + Prisma + PostgreSQL
- `front/`: Next.js + TypeScript

## Puesta en marcha

### Base de datos

```bash
docker compose up -d
```

PostgreSQL queda en `localhost:5432` con:

- DB: `jurisprudencia_db`
- User: `postgres`
- Password: `postgres`

### Backend

```bash
cd back
npm install
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run start:dev
```

Backend:

- API: `http://localhost:4001/api`
- Health: `http://localhost:4001/api/health`
- Swagger: `http://localhost:4001/api/docs`

Usuarios iniciales:

- Email: `admin@jurisprudencia.local`
- Password: `Admin12345`
- Rol: `ADMIN`

- Email: `operador@jurisprudencia.local`
- Password: `Operador12345`
- Rol: `OPERADOR`

Prueba rápida de auth:

- `POST http://localhost:4001/api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/change-password`

PowerShell:

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:4001/api/auth/login" -ContentType "application/json" -Body '{"email":"admin@jurisprudencia.local","password":"Admin12345"}'
```

Swagger:

- abrir `http://localhost:4001/api/docs`
- usar `Authorize`
- enviar el JWT emitido por `/api/auth/login`

### Frontend

```bash
cd front
npm install
npm run dev
```

Configurar `front/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://10.5.3.138:4001/api
PORT=4001
```

Frontend:

- App: `http://localhost:4001`
- App LAN: `http://10.5.3.138:4001`
- Login: `http://localhost:4001/login`
- Login LAN: `http://10.5.3.138:4001/login`
- El script `npm run dev` levanta Next en `4001`.
- Desde la misma PC tambien puede usarse `NEXT_PUBLIC_API_URL=http://localhost:4001/api`.

## Variables importantes

### Backend

```env
DATABASE_URL=postgresql://<user>:<password>@localhost:5432/<database>
PORT=4001
FRONTEND_URL=http://localhost:4001
FRONTEND_URLS=http://localhost:4001,http://10.5.3.138:4001
JWT_SECRET=replace-with-a-long-random-secret
JWT_EXPIRES_IN="8h"
SQLITE_SOURCE_PATH="./data/jurisprudencia_db.sqlite"
SQLITE_PDF_BASE_PATH="./data/pdfs"
IMPORT_BATCH_SIZE=100
```

Archivo de ejemplo:

- `back/.env.example`

## Puerto ocupado

Puerto estandar del backend:

- `4001`

Si al levantar aparece `EADDRINUSE`, revisar en PowerShell:

```powershell
netstat -ano | findstr :4001
taskkill /PID <PID> /F
```

Si hay varios procesos `node` viejos:

```powershell
taskkill /F /IM node.exe
```

Alternativa temporal:

```bash
cd back
npm run start:dev:4001
```

Si cambiás el puerto del backend, también tenés que cambiar en frontend:

```env
NEXT_PUBLIC_API_URL=http://localhost:4001/api
```

Por ejemplo, si el backend corre en `4001`:

```env
NEXT_PUBLIC_API_URL=http://localhost:4001/api
```

### Frontend

```env
NEXT_PUBLIC_API_URL=http://10.5.3.138:4001/api
PORT=4001
```

## Endpoints principales nuevos

## Consulta pública y acceso

La consulta pública no requiere login:

- `GET /api/public/búsqueda`
- `GET /api/public/búsqueda/sugerencias`
- `GET /api/public/búsqueda/temas`
- `GET /api/public/búsqueda/salas`
- `GET /api/public/búsqueda/tipos-fallo`
- `GET /api/public/sentencias/:slug`
- `GET /api/public/sentencias/:slug/documento`
- `GET /api/public/sentencias/:slug/ficha`
- `GET /api/public/sentencias/:slug/pdf`
- `GET /api/public/sentencias/:slug/citas`

Rutas públicas frontend:

- `/`
- `/login`
- `/consulta`
- `/consulta/resultados`
- `/consulta/sentencia/[slug]`
- `/consulta/sentencia/[slug]/documento`
- `/consulta/sentencia/[slug]/ficha`

Rutas protegidas frontend:

- `/dashboard`
- `/sentencias`
- `/sentencias/nueva-completa`
- `/sentencias/carga-rápida`
- `/búsqueda-avanzada`
- `/estadísticas`
- `/admin/logs`
- `/normas`
- `/institutos-jurídicos`

## Informe anual

Endpoint de datos:

- `GET /api/estadísticas/anual?anio=2026`

Exportación:

- `GET /api/estadísticas/anual/exportar?anio=2026&formato=pdf`
- `GET /api/estadísticas/anual/exportar?anio=2026&formato=docx`

El PDF descarga el informe anual. DOCX queda documentado como endpoint y responde que debe usarse PDF hasta incorporar una libreria DOCX estable.

En el frontend, abrir `/estadísticas`, seccion `Informe anual`, elegir `Año` y usar `Ver estadísticas`, `Descargar PDF` o `Descargar Word`.

## RAG local con Ollama

La integración RAG usa solo servicios locales/gratuitos:

- Ollama: `http://localhost:11434`
- Modelo generativo sugerido: `llama3`
- Modelo de embeddings: `nomic-embed-text`
- Extracción de PDF: `pdf-parse`
- Base vectorial simple: PostgreSQL, tabla `EmbeddingDocumento`

Variables opcionales:

```env
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_GENERATION_MODEL=llama3
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
IA_MAX_CHARS=30000
RAG_INDEX_BATCH_SIZE=25
```

Preparar Ollama manualmente:

```bash
ollama pull llama3
ollama pull nomic-embed-text
```

Indexar datos existentes:

```bash
cd back
npm run ia:indexar:dry
npm run ia:indexar
```

El script recorre sentencias, sumarios y el PDF principal si existe. Es idempotente: no duplica embeddings ya existentes.

Health de Ollama:

- `GET /api/ia/health`

Endpoints protegidos de IA/RAG:

- `POST /api/sentencias/:id/reseña/generar-ia`
- `POST /api/sentencias/:id/ia/reseña-sugerida`
- `GET /api/sentencias/:id/similares?limit=10`
- `POST /api/sentencias/:id/referencias-normativas/detectar`

La sugerencia se guarda en `reseñaAi` y no sobrescribe `reseña`. En el frontend, en el detalle de sentencia, la sección `Reseña` muestra `Reseña sugerida por IA`, botón `Regenerar reseña sugerida por IA` y botón `Usar sugerencia`.

La IA genera borradores editables y nunca publica sola. Si Ollama no está levantado, el endpoint devuelve un error claro indicando que hay que abrir `http://localhost:11434`; login, búsqueda y carga manual siguen funcionando.

La detección de normas no usa IA: busca patrones como `art. 1757`, `arts. 1757 y 1758`, `art. 163 inc. 6 CPCCN`, `CCyC`, `CPCCN` y `Ley 24.240`. Las referencias detectadas se crean como datos revisables y no se publican automáticamente.

## Búsqueda con Ñ y acentos

La búsqueda mantiene el texto original para mostrar resultados y usa una version normalizada solo para comparar. La normalizacion:

- pasa a minusculas
- remueve acentos para comparar
- permite equivalencias como `ñ`/`n`
- no cambia el texto visible guardado ni mostrado

Pruebas sugeridas:

- `daño` y `dano`
- `año` y `ano`
- `niño` y `nino`
- `cañada` y `canada`

### Sentencias

```txt
GET    /api/sentencias
GET    /api/sentencias/destacadas
GET    /api/sentencias/:id
GET    /api/sentencias/:id/completa
GET    /api/sentencias/:id/resumen
PATCH  /api/sentencias/:id/resumen
PATCH  /api/sentencias/:id/reseña
GET    /api/sentencias/:id/reseña
PATCH  /api/sentencias/:id/reseña/publicar
PATCH  /api/sentencias/:id/reseña/despublicar
GET    /api/sentencias/:id/cita
POST   /api/sentencias/:id/generar-cita
GET    /api/sentencias/:id/ficha
GET    /api/sentencias/:id/exportar-ficha?formato=json|txt|html
POST   /api/sentencias/:id/generar-slug
PATCH  /api/sentencias/:id/destacar
PATCH  /api/sentencias/:id/quitar-destacada
```

### Favoritos

```txt
GET    /api/favoritos
POST   /api/favoritos/:sentenciaId
DELETE /api/favoritos/:sentenciaId
```

### Búsquedas guardadas

```txt
GET    /api/búsquedas-guardadas
GET    /api/búsquedas-guardadas/:id
POST   /api/búsquedas-guardadas
PATCH  /api/búsquedas-guardadas/:id
DELETE /api/búsquedas-guardadas/:id
```

### Exportación y consulta pública

```txt
GET /api/búsqueda/avanzada
GET /api/búsqueda/avanzada/exportar?formato=csv|json|txt
GET /api/búsqueda/simple
GET /api/búsqueda/sugerencias?q=...
GET /api/búsqueda/temas
GET /api/búsqueda/salas
GET /api/búsqueda/tipos-fallo
GET /api/búsqueda/cita?q=...
GET /api/public/búsqueda
GET /api/public/sentencias/:slug
GET /api/public/sentencias/:slug/citas
GET /api/estadísticas/resumen-general
GET /api/estadísticas/por-anio
GET /api/estadísticas/por-sala
GET /api/estadísticas/por-tipo-fallo
GET /api/estadísticas/por-tema
GET /api/estadísticas/calidad-datos
GET /api/estadísticas/publicación
GET /api/estadísticas/uso/búsquedas
GET /api/estadísticas/uso/sentencias-mas-vistas
GET /api/estadísticas/uso/descargas-pdf
GET /api/estadísticas/uso/favoritos
GET /api/estadísticas/uso/compartidos
POST /api/estadísticas/eventos/share-link
```

## Búsqueda administrativa

Sintaxis soportada en esta version:

- texto libre: `daños y perjuicios mala praxis`
- frase exacta: `"daño moral"`
- exclusion: `mala praxis -penal`
- operador `OR`: `mala praxis OR responsabilidad medica`
- prefijos de campo en `q`:
  - `tema:"daño moral"`
  - `sala:C`
  - `tipo:"sentencia interlocutoria"`
  - `expediente:"123/2024"`
  - `actor:"Perez"`
  - `demandado:"Gomez"`
- filtros por query params en búsqueda interna:
  - número de sentencia, número de sumario, expediente, actor, demandado, objeto, magistrados, sala, tipo de fallo, tema, año, fecha desde/hasta, solo con PDF, solo con resumen, destacada, campo de búsqueda y orden

Separacion funcional:

- Consulta pública: `GET /api/public/búsqueda`
  - solo contenido publicado
  - orientada a lectura rápida
- Modulo interno: `GET /api/búsqueda/avanzada`
  - filtros finos
  - exportacion
  - resultados con relevancia

## Relevancia, highlights y performance

La búsqueda ahora usa:

- `score` ponderado por campo
- prioridad alta para coincidencias exactas en:
  - número de sentencia
  - expediente
  - tema
  - resumen
  - reseña
- highlights HTML seguros con `<mark>` en:
  - resumen
  - reseña
  - tema
  - sumario
  - actor / demandado / objeto
- columnas auxiliares:
  - `textoBúsqueda`
  - `textoBúsquedaNormalizado`
  - `caratula`
  - año
  - `tienePdf`
- indices compuestos para filtros frecuentes:
  - `[publicado, fecha]`
  - `[activo, fecha]`
  - `[sala, fecha]`
  - `[tipoFallo, fecha]`

Eventos registrados:

- `search_public`
- `search_internal`
- `search_internal_simple`
- `search_internal_cita`
- `view_sentencia`
- `download_pdf`
- `favorite_add`
- `favorite_remove`
- `share_link`

## Reseña jurídica y citas del fallo

- La reseña es editorial/manual.
- Puede recibir un borrador IA editable desde Ollama/RAG, pero nunca se publica automáticamente.
- Se edita desde:
  - `GET /api/sentencias/:id/reseña`
  - `PATCH /api/sentencias/:id/reseña`
  - `PATCH /api/sentencias/:id/reseña/publicar`
  - `PATCH /api/sentencias/:id/reseña/despublicar`
- Solo se expone públicamente si `reseñaPublicada=true`.

Gestion de citas:

- `GET /api/sentencias/:id/citas`
- `POST /api/sentencias/:id/citas`
- `POST /api/sentencias/:id/citas/detectar`
- `PATCH /api/citas-fallo/:id`
- `DELETE /api/citas-fallo/:id`

Patrones detectados en esta version:

- `Fallos: 342:533`
- `Fallos 336:2231`
- `CSJ 58/2014`
- `CAF 35134/2018/CS2`
- `CIV 12345/2020`
- `Expte. 12345/2020`
- `Expediente N° 12345/2020`

Las citas detectadas automáticamente:

- quedan `confirmada=false`
- no se duplican si ya existe `sentenciaId + tipo + referencia`
- se revisan y confirman manualmente antes de tratarlas como validas

## Funciones incorporadas

- resumen del fallo editable
- reseña editorial
- reseña publicable con control manual
- trazabilidad básica de actualización/publicación de reseña
- cita generable y copiable
- deteccion automatica de citas por patrones
- confirmacion manual de citas detectadas
- ficha de sentencia para impresión/exportacion
- favoritos por usuario
- búsquedas guardadas por usuario
- slug público para compartir sentencias publicadas
- exportacion de resultados en `csv`, `json` y `txt`
- sentencias destacadas

## Frontend administrativo

Paginas principales:

- `/dashboard`
- `/búsqueda-avanzada`
- `/estadísticas`
- `/sentencias`
- `/sentencias/[id]`
- `/sentencias/[id]/imprimir`
- `/favoritos`
- `/búsquedas-guardadas`
- `/sumarios`
- `/archivos`

Consulta pública:

- `/consulta`
- `/consulta/imprimir`
- `/consulta/resultados`
- `/consulta/sentencia/[slug]`
- `/consulta/sentencia/[slug]/ficha`

Funciones visibles:

- guardar/quitar favoritos
- guardar búsquedas
- exportar resultados
- sugerencias de temas, salas y tipos de fallo
- editar resumen y reseña
- copiar cita
- imprimir ficha
- copiar enlace interno
- copiar enlace público si existe slug
- marcar sentencia destacada

## Consulta pública tipo Infocivil

La consulta pública usa:

- `GET /api/public/búsqueda`
- `GET /api/public/sentencias/:slug`
- `GET /api/public/sentencias/:slug/ficha`
- `GET /api/public/sentencias/:slug/citas`
- `GET /api/public/sentencias/:slug/pdf`

## Analisis documental jurídico

La reseña:

- es manual/editorial
- puede recibir un borrador IA editable desde Ollama/RAG
- puede guardarse y luego publicarse
- solo aparece en público si `reseñaPublicada=true`

La seccion `Este fallo cita a`:

- admite carga manual
- detecta patrones frecuentes por regex
- deja las citas detectadas como pendientes hasta confirmacion
- evita duplicados por `sentenciaId + tipo + referencia`

Patrones incluidos:

- `Fallos: 342:533`
- `CSJ 58/2014`
- `CAF 35134/2018/CS2`
- `CIV 12345/2020`
- `Expte. 12345/2020`
- `Expediente N° 12345/2020`
- `causa N° 12345/2020`
- `CNCiv, Sala A`
- `Sala A, 12/03/2024`

Filtros disponibles:

- `tema`
- `sala`
- `fechaDesde`
- `fechaHasta`
- `tipoFallo`
- `númeroSumario`
- `númeroSentencia`
- `magistrados`
- `caratula`
- `expediente`
- `q`

Funciones incorporadas en `/consulta`:

- filtros visibles con query params compartibles
- resaltado de coincidencias con `<mark>`
- seleccion multiple de resultados
- impresión de seleccionados o de la página actual
- botón `Fallo` para abrir el PDF público si existe
- aviso cuando la búsqueda supera el umbral de resultados visibles

## Búsqueda simple e intuitiva

La búsqueda simple interpreta el texto de forma automatica:

- espacio = `AND`
- comillas = frase exacta
- `-termino` = exclusion
- `OR` = alternativa explicita

Ejemplos:

- `accidente moto`
- `"daño moral"`
- `accidente -penal`
- `accidente OR moto`

Diferencia con la búsqueda administrativa:

- `/consulta` prioriza simplicidad y filtros visibles
- `/búsqueda-avanzada` mantiene filtros finos, exportacion y herramientas internas

## Sugerencias y relevancia

Nuevos endpoints de sugerencias:

- `GET /api/búsqueda/sugerencias?q=`
- `GET /api/búsqueda/sugerencias/temas?q=`
- `GET /api/búsqueda/sugerencias/magistrados?q=`
- `GET /api/búsqueda/sugerencias/salas?q=`
- `GET /api/búsqueda/sugerencias/tipos-fallo?q=`
- `GET /api/búsqueda/sugerencias/expedientes?q=`
- `GET /api/búsqueda/sugerencias/caratulas?q=`
- `GET /api/public/búsqueda/sugerencias?q=`

La búsqueda usa:

- autocomplete con debounce en `/consulta` y `/búsqueda-avanzada`
- expansion por sinonimos jurídicos activos
- orden de relevancia por campo con prioridad para número, expediente, tema, sumario, resumen y reseña
- prioridad por sentencia publicada, destacada, con PDF y con reseña publicada
- `matchedFields`, `matchInfo` y `expandedTerms` en la respuesta

No se agrego una tabla persistente de terminos frecuentes en esta iteracion; las sugerencias se calculan con datos reales de sentencias, sumarios y eventos.

## Métricas y historial

Nuevos endpoints:

- `GET /api/estadísticas/uso/resumen`
- `GET /api/estadísticas/uso/búsquedas-populares`
- `GET /api/estadísticas/uso/búsquedas-sin-resultados`
- `GET /api/estadísticas/uso/filtros-mas-usados`
- `GET /api/estadísticas/uso/sugerencias-clicks`
- `GET /api/estadísticas/uso/documentos-mas-consultados`
- `GET /api/estadísticas/uso/documentos-mas-descargados`
- `GET /api/estadísticas/uso/actividad-por-dia`
- `GET /api/sentencias/:id/historial`

Eventos relevantes registrados:

- `search_public`
- `search_internal`
- `suggestion_click`
- `view_sentencia`
- `view_documento`
- `download_pdf`
- `print_result`
- `print_ficha`
- `share_link`
- `favorite_add`
- `favorite_remove`
- `export_results`

El historial de sentencia reutiliza `AccionLog` y muestra la trazabilidad interna del fallo, sin exponer auditoría en la vista publica.

## Importacion desde SQLite

Ubicacion esperada en el repo:

- SQLite legacy: `back/data/jurisprudencia_db.sqlite`
- PDFs legacy: `back/data/pdfs/`

Estos archivos no deben subirse al repositorio.

Variables requeridas en `back/.env`:

```env
SQLITE_SOURCE_PATH="./data/jurisprudencia_db.sqlite"
SQLITE_PDF_BASE_PATH="./data/pdfs"
IMPORT_BATCH_SIZE=100
```

Orden recomendado:

```bash
cd back
npm run import:sqlite:inspect
npm run import:pdfs:inspect
npm run import:sqlite:dry
npm run import:sqlite
npm run import:pdfs:dry
npm run import:pdfs
npm run import:validate
```

Scripts disponibles:

```bash
npm run import:sqlite:inspect
npm run import:sqlite:dry
npm run import:sqlite
npm run import:sqlite:sentencias
npm run import:sqlite:sumarios
npm run import:pdfs:inspect
npm run import:pdfs:dry
npm run import:pdfs
npm run import:validate
```

Comportamiento:

- la importación usa `legacyId` y es reejecutable
- sentencias y sumarios se hacen con `upsert`
- el dry-run lee, mapea y reporta, pero no escribe en PostgreSQL ni copia PDFs
- los logs quedan en `back/logs/importación/`

Checks SQL utiles después de importar:

```sql
SELECT COUNT(*) FROM "Sentencia";
SELECT COUNT(*) FROM "Sentencia" WHERE publicado = true AND activo = true;
SELECT COUNT(*) FROM "Sumario";
SELECT COUNT(*) FROM "Sumario" WHERE publicado = true AND activo = true;
```

Si la consulta pública queda vacía después de una importación legacy, publicar los datos importados sin tocar sentencias manuales:

```bash
cd back
npm run mantenimiento:publicar-legacy:dry
npm run mantenimiento:publicar-legacy
```

Matching de PDFs:

1. intenta usar `link` o ruta explicita si la SQLite la trae
2. intenta por `codigo_sentencia`
3. intenta por `id_sentencia`
4. intenta por `nro_expte` normalizado
5. solo acepta matches no ambiguos para evitar asociaciones falsas

Reporte de PDFs:

- sentencias con PDF encontrado
- sentencias sin PDF encontrado
- PDFs huérfanos
- estrategia usada por match

Validacion post import:

- total de sentencias con `legacyId`
- total de sumarios con `legacyId`
- total de PDFs importados
- sentencias sin sumarios
- sentencias con `tienePdf=true` pero sin `ArchivoPdf`
- `ArchivoPdf` cuyo archivo fisico ya no existe

## Referencias y anonimización

Referencias nuevas por sentencia:

- Normas relacionadas
- Jurisprudencia relacionada
- Doctrina

Endpoints internos:

- `GET|POST /api/sentencias/:id/referencias-normativas`
- `PATCH|DELETE /api/referencias-normativas/:id`
- `GET|POST /api/sentencias/:id/referencias-jurisprudenciales`
- `PATCH|DELETE /api/referencias-jurisprudenciales/:id`
- `GET|POST /api/sentencias/:id/referencias-doctrinarias`
- `PATCH|DELETE /api/referencias-doctrinarias/:id`
- `PATCH /api/sentencias/:id/anonimizar`
- `PATCH /api/sentencias/:id/desanonimizar`

Reglas de publicación:

- la vista pública usa `actorPúblico` y `demandadoPúblico` si `anonimizado=true`
- referencias solo se muestran en público si la sentencia está publicada
- la vista pública no expone datos internos de trabajo

## Institutos jurídicos y equivalencias normativas

El sistema ahora permite:

- gestionar institutos jurídicos y sus sinónimos
- expandir la búsqueda pública e interna con términos relacionados
- cargar artículos de normas
- relacionar artículos viejos/nuevos o vinculados mediante equivalencias

Ejemplos de expansión:

- `patria potestad` -> `responsabilidad parental`
- `tenencia` -> `cuidado personal`
- `régimen de visitas` -> `comunicación`
- `usucapión` -> `prescripción adquisitiva`

Nuevos endpoints:

- `GET|POST|PATCH|DELETE /api/institutos-jurídicos...`
- `GET|POST /api/institutos-jurídicos/:id/sinonimos`
- `PATCH|DELETE /api/sinonimos-jurídicos/:id`
- `GET|POST|PATCH|DELETE /api/normas...`
- `GET|POST /api/normas/:id/equivalencias`
- `DELETE /api/equivalencias-normativas/:id`

La expansión de búsqueda devuelve en `meta.expandedTerms` los términos agregados automáticamente.

## Visor documental

Rutas:

- interno: `/sentencias/[id]/documento`
- público: `/consulta/sentencia/[slug]/documento`

Endpoints:

- `GET /api/sentencias/:id/documento`
- `GET /api/public/sentencias/:slug/documento`
- `GET /api/archivos/:id/download`
- `GET /api/public/sentencias/:slug/pdf`

El visor muestra el PDF integrado dentro del sistema y un panel lateral con:

- magistrados
- sumarios
- reseña
- citas del fallo
- referencias normativas, jurisprudenciales y doctrinarias
- más información
- descarga, impresión y compartir

En la vista interna el PDF se resuelve descargando el blob con bearer token y montándolo en un `iframe`. En la vista pública se usa el endpoint público seguro del PDF. Si la impresión directa depende del navegador, el visor permite abrir el PDF en una pestaña aparte.

## Asistente de carga interna

Ruta:

- `/sentencias/nueva-completa`

Flujo:

1. datos básicos
2. selección de PDF
3. sumarios
4. reseña
5. referencias
6. publicación y anonimización
7. vista previa

Decisión de implementación:

- el borrador se crea al salir del paso 1
- el PDF se selecciona en el paso 2 y se sube al guardar la carga final
- esto evita obligar al usuario a reemplazar archivos ya persistidos durante el armado

Estados de carga:

- `BORRADOR`
- `COMPLETA`
- `PUBLICADA`

## Carga rápida y catálogos

Rutas nuevas:

- `/sentencias/carga-rápida`
- `GET /api/catálogos/salas`
- `GET /api/catálogos/tipos-fallo`
- `GET /api/catálogos/tribunales-origen`

Gestion interna de catálogos:

- `POST|PATCH /api/catálogos/salas`
- `POST|PATCH /api/catálogos/tipos-fallo`
- `POST|PATCH /api/catálogos/tribunales-origen`

La carga rápida:

- busca una sentencia por número
- si no existe, permite crearla en el momento
- graba sentencia y sumario en una sola accion
- permite seleccionar `Sala`, `Tipo de fallo` y `Tribunal de origen` desde catálogos
- admite PDF opcional
- no reemplaza al wizard completo

Compatibilidad:

- `Sentencia` mantiene `sala`, `tipoFallo` y `tribunalOrigen` como strings
- tambien puede guardar `salaId`, `tipoFalloId` y `tribunalOrigenId`
- si se usa un catalogo, el backend persiste tanto el id como el texto para no romper búsquedas ni pantallas existentes

## Auditoria

La auditoría registra acciones de usuarios autenticados sobre:

- sentencias
- sumarios
- reseñas
- citas
- referencias
- PDFs

Modelo:

- `AccionLog`

Endpoints:

- `GET /api/logs`
- `GET /api/logs/:id`

Filtros soportados:

- `usuarioId`
- `entidad`
- `accion`
- `fechaDesde`
- `fechaHasta`

Reglas:

- solo `ADMIN` puede consultar logs
- el sistema guarda `datosAntes` y `datosDespues` cuando aplica
- no se expone auditoría en la vista publica

## Migraciones

Migraciones relevantes:

- `back/prisma/migrations/20260423113000_backend_completo/migration.sql`
- `back/prisma/migrations/20260423170000_consulta_features/migration.sql`

Si `prisma migrate dev` falla por credenciales o Docker apagado, el SQL incremental ya esta generado en esa carpeta.

## Seed para migracion real

`npm run prisma:seed` deja una base minima para operar el sistema y preparar la importación real:

- roles `ADMIN` y `OPERADOR`
- usuario administrador `admin@jurisprudencia.local / Admin12345`
- usuario operador `operador@jurisprudencia.local / Operador12345`
- catalogo de 13 salas, de `Sala A` a `Sala M`
- catalogo de 110 tribunales de origen, de `Juzgado 1` a `Juzgado 110`
- tipos de fallo minimos: `Libre` y `Relación`

La seed no crea sentencias, sumarios, PDFs, referencias, citas, embeddings, eventos, logs, favoritos ni búsquedas guardadas. Es idempotente y usa `upsert` para no duplicar roles, usuarios ni catálogos.

Las sentencias se importan luego desde la base vieja hacia PostgreSQL con los scripts de importación. Los PDFs se asocian después con los scripts de diagnostico y matching, especialmente `import:pdfs:inspect`, `import:pdfs:dry`, `import:pdfs` y las tareas de mantenimiento de PDFs.

## Rutas principales

Internas:

- `/login`
- `/dashboard`
- `/sentencias`
- `/sentencias/nueva`
- `/sentencias/nueva-completa`
- `/sentencias/[id]`
- `/sentencias/[id]/documento`
- `/búsqueda-avanzada`
- `/estadísticas`
- `/favoritos`
- `/búsquedas-guardadas`
- `/institutos-jurídicos`
- `/normas`
- `/admin/logs`

Publicas:

- `/consulta`
- `/consulta/resultados`
- `/consulta/sentencia/[slug]`
- `/consulta/sentencia/[slug]/documento`
- `/consulta/sentencia/[slug]/ficha`
- `/consulta/imprimir`

## Flujo de prueba recomendado

1. Levantar PostgreSQL con `docker compose up -d`
2. Backend:
   - `cd back`
   - `npm install`
   - `npm run prisma:generate`
   - `npm run prisma:migrate`
   - `npm run prisma:seed`
   - `npm run start:dev`
3. Frontend:
   - `cd front`
   - `npm install`
   - crear `front/.env.local` con `NEXT_PUBLIC_API_URL=http://localhost:4001/api`
   - `npm run dev`
4. Login:
   - admin: `admin@jurisprudencia.local / Admin12345`
   - operador: `operador@jurisprudencia.local / Operador12345`
5. Validar en este orden:
   - `/dashboard`
   - `/sentencias`
   - `/sentencias/nueva-completa`
   - `/consulta`
   - `/búsqueda-avanzada`
   - `/estadísticas`
   - `/admin/logs` con admin
6. Usar `CHECKLIST_FUNCIONAL.md` para la pasada completa de verificacion


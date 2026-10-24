# Galilei Client

Aplicación interna de jurisprudencia civil construida con React, Vite y TypeScript.

## Configuracion

Crear `client/.env.local` solamente si se necesita cambiar el valor por defecto:

```env
VITE_API_URL=/api
# Opcional: origen del backend al que el proxy de Vite envía /api.
BJC_DEV_API_PROXY=http://127.0.0.1:4000
```

`VITE_API_URL` solo admite un origen público seguro o el proxy same-origin `/api`; no debe contener credenciales ni secretos.

## Ejecucion

```bash
pnpm install
pnpm --filter front dev
```

El frontend de desarrollo escucha en `http://localhost:4001`. El comando raíz `pnpm dev` inicia también el backend local. En producción, publicar el contenido de `client/dist` en un servidor estático con fallback de rutas SPA a `index.html`; `vite preview` solo sirve para validar localmente.

## Flujo principal

1. Login con `POST /auth/login`
2. Validación de sesión con `GET /auth/me`
3. Rutas protegidas para dashboard, sentencias, sumarios, archivos, favoritos y búsquedas guardadas

Con el proxy local predeterminado, el login real llama a:

- `POST /api/auth/login`

## Consulta pública sin login

Rutas públicas:

- `/consulta`
- `/consulta/resultados`
- `/consulta/sentencia/[slug]`
- `/consulta/sentencia/[slug]/documento`
- `/consulta/sentencia/[slug]/ficha`

La vista publica no muestra sidebar admin ni botónes de carga/edicion. Solo consume endpoints `/public/*`.

## Informe anual

En `/estadísticas`, la seccion `Informe anual` permite elegir `Año`, ver estadísticas y descargar PDF. DOCX queda documentado en backend, pero por ahora informa que se use PDF.

## Búsqueda con Ñ y acentos

La búsqueda publica e interna compara texto normalizado, pero muestra el texto original. Probar:

- `daño` / `dano`
- `año` / `ano`
- `niño` / `nino`
- `cañada` / `canada`

No guardar credenciales de prueba en este README. Use únicamente una cuenta DEV gestionada localmente.

## Paginas

- `/login`
- `/dashboard`
- `/estadísticas`
- `/búsqueda-avanzada`
- `/sentencias`
- `/sentencias/nueva`
- `/sentencias/nueva-completa`
- `/sentencias/[id]`
- `/sentencias/[id]/documento`
- `/sentencias/[id]/imprimir`
- `/sumarios`
- `/archivos`
- `/favoritos`
- `/búsquedas-guardadas`
- `/consulta`
- `/consulta/resultados`
- `/consulta/sentencia/[slug]`
- `/consulta/sentencia/[slug]/documento`

## Funciones nuevas

- resumen editable
- reseña editable
- reseña publicable / despublicable
- cita copiable y regenerable
- favoritos
- búsquedas guardadas
- exportacion de resultados
- impresión de ficha
- enlace interno y enlace público
- sentencias destacadas en dashboard
- consulta pública separada
- ayuda de sintaxis de búsqueda
- sugerencias de temas, salas y tipos de fallo
- highlights de coincidencias
- relevancia visible en búsqueda interna
- panel de control y página de estadísticas
- deteccion y revision de citas del fallo
- visor documental integrado con PDF embebido
- asistente de carga completa por pasos para sentencias
- panel de auditoría para administradores

## Endpoints consumidos

- `POST /auth/login`
- `GET /auth/me`
- `GET /sentencias`
- `GET /sentencias/destacadas`
- `GET /sentencias/:id/completa`
- `PATCH /sentencias/:id`
- `GET /sentencias/:id/resumen`
- `GET /sentencias/:id/reseña`
- `PATCH /sentencias/:id/resumen`
- `PATCH /sentencias/:id/reseña`
- `PATCH /sentencias/:id/reseña/publicar`
- `PATCH /sentencias/:id/reseña/despublicar`
- `GET /sentencias/:id/cita`
- `POST /sentencias/:id/generar-cita`
- `GET /sentencias/:id/citas`
- `POST /sentencias/:id/citas`
- `POST /sentencias/:id/citas/detectar`
- `PATCH /citas-fallo/:id`
- `DELETE /citas-fallo/:id`
- `GET /sentencias/:id/ficha`
- `GET /sentencias/:id/documento`
- `POST /sentencias/:id/generar-slug`
- `PATCH /sentencias/:id/destacar`
- `PATCH /sentencias/:id/quitar-destacada`
- `GET /favoritos`
- `POST /favoritos/:sentenciaId`
- `DELETE /favoritos/:sentenciaId`
- `GET /búsquedas-guardadas`
- `POST /búsquedas-guardadas`
- `PATCH /búsquedas-guardadas/:id`
- `DELETE /búsquedas-guardadas/:id`
- `GET /búsqueda/avanzada`
- `GET /búsqueda/avanzada/exportar`
- `GET /búsqueda/sugerencias`
- `GET /búsqueda/temas`
- `GET /búsqueda/salas`
- `GET /búsqueda/tipos-fallo`
- `GET /búsqueda/cita`
- `GET /public/búsqueda`
- `GET /public/sentencias/:slug`
- `GET /public/sentencias/:slug/citas`
- `GET /public/sentencias/:slug/ficha`
- `GET /public/sentencias/:slug/documento`
- `GET /estadísticas/resumen-general`
- `GET /estadísticas/por-anio`
- `GET /estadísticas/por-sala`
- `GET /estadísticas/por-tipo-fallo`
- `GET /estadísticas/por-tema`
- `GET /estadísticas/calidad-datos`
- `GET /estadísticas/publicación`
- `GET /estadísticas/uso/búsquedas`
- `GET /estadísticas/uso/sentencias-mas-vistas`
- `GET /estadísticas/uso/descargas-pdf`
- `POST /estadísticas/eventos/share-link`
- `GET /logs`
- `GET /logs/:id`

## Sintaxis de búsqueda

Ejemplos soportados:

- `"daño moral"`
- `mala praxis OR responsabilidad medica`
- `daño -penal`
- `tema:"daño moral" sala:C`

Autocomplete:

- `/consulta` usa sugerencias publicas seguras mientras se escribe
- `/búsqueda-avanzada` agrega autocomplete para tema, magistrados, sala, tipo de fallo, expediente y caratula
- las sugerencias se consultan con debounce de 300 ms

## Citas del fallo

La deteccion automatica reconoce referencias frecuentes como:

- `Fallos: 342:533`
- `Fallos 336:2231`
- `CSJ 58/2014`
- `CAF 35134/2018/CS2`
- `CIV 12345/2020`
- `Expte. 12345/2020`
- `Expediente N° 12345/2020`

Las citas detectadas quedan pendientes hasta que un operador las confirme.

## Visor documental

Rutas:

- interno: `/sentencias/[id]/documento`
- público: `/consulta/sentencia/[slug]/documento`

El visor integra:

- PDF embebido dentro de la pantalla
- panel lateral con sumarios, reseña, citas, referencias y metadatos
- acciones de descarga, impresión y compartir

En la vista interna el PDF se obtiene con descarga autenticada y se monta en un `iframe`. En la vista pública se consume el endpoint público del PDF.

## Wizard de carga

Ruta:

- `/sentencias/nueva-completa`

Pasos:

1. datos básicos
2. PDF
3. sumarios
4. reseña
5. referencias
6. publicación y anonimización
7. vista previa

El borrador se crea al avanzar desde el primer paso. El PDF se mantiene seleccionado localmente hasta el guardado final para evitar fricción al reemplazarlo durante la carga.

## Auditoria

Ruta:

- `/admin/logs`

La pantalla permite filtrar por:

- usuario
- entidad
- accion
- rango de fechas

Solo usuarios `ADMIN` pueden consultar el log completo y ver `datosAntes` / `datosDespues`.

## Sesion y acceso

- el token JWT se guarda en `localStorage`
- el usuario autenticado se refresca con `GET /auth/me`
- ante `401` se limpia la sesión y se redirige a `/login`
- `/admin/logs` queda visible y accesible solo para `ADMIN`

## Historial de sentencia

En `/sentencias/[id]` se agrego un bloque `Historial` que consume:

- `GET /sentencias/:id/historial`

Muestra acciones recientes sobre la sentencia y permite desplegar `datosAntes` / `datosDespues`.

## Nota

El frontend asume respuestas tipo:

- listado: `{ data, meta }`
- detalle: `{ data }`

# Hardening y preparación operativa — Sprint 11

**Estado: controles locales implementados en parte; sin aprobación para red compartida ni preproducción.**

## Controles añadidos en esta iteración

- `/api/health/live` verifica que la API responda; `/api/health/ready` y `/api/health` consultan `SELECT 1` y accesibilidad de storage. La respuesta no muestra URL ni ruta local.
- `X-Request-Id` valida un ID entrante acotado o crea UUID. Los logs de error HTTP registran ruta de plantilla, método, status, duración y categoría; no registran query string ni body.
- El filtro global transforma errores 5xx en respuesta genérica con request ID y omite mensajes internos.
- Rate limit local por IP y categoría con ventana y límites configurables (`API_RATE_LIMIT_*`); respuesta 429 incluye `Retry-After`. El contador reside en memoria de un proceso: no es distribuido y requiere proxy/IP real y almacenamiento coordinado antes de escalar.
- El profiling de búsqueda sólo se activa con `BJC_SEARCH_PROFILE=true` fuera de producción. Debug queda opt-in y no contiene texto de consulta.
- `AuthModule` exige `JWT_SECRET` y valida `JWT_EXPIRES_IN` como intervalo explícito; el ejemplo fija `8h`. `JwtStrategy` consulta usuario/rol/activo en cada request; E2E confirma expiración, rol actualizado y desactivación. La UI de administración cierra sesión y vuelve a login.
- En producción CORS exige `FRONTEND_URL`/`FRONTEND_URLS` y no incorpora los orígenes locales de DEV.
- Estado de rate limit por defecto: ventana 60 s; login 15, búsqueda/matches/descargas 120 requests por IP. Desactivación explícita sólo con `API_RATE_LIMIT_ENABLED=false`. No es limitador distribuido.

## Pendientes de gate

Pendiente: definir secretos fuera del repositorio, TLS, proxy confiable, límites de tamaño/tiempo de PDF, rate limit distribuido si hay réplicas, retención de logs, monitoreo y alertas. No subir `API_RATE_LIMIT_ENABLED=false` en entorno compartido. Validar permisos de storage y recuperación de backups en DB temporal aislada antes de una prueba de preproducción.

Los controles del proceso local son evidencia de implementación, no una certificación de seguridad. La UAT humana y la aceptación de ACL continúan pendientes.

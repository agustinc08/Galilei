# Hardening final preproducción — Sprint 12

## Evidencia local

- `JWT_SECRET` es requerido y `JWT_EXPIRES_IN` configurable; la estrategia vuelve a consultar usuario, rol y estado activo por request. Pruebas de expiración, rol cambiado, usuario deshabilitado y logout constan en Sprint 11; UI vuelve a login al cerrar sesión.
- Rate limit por proceso/IP/categoría: login 15 por ventana de 60 s; búsqueda/matches/descarga 120; respuesta 429 y `Retry-After`. No es compartido entre réplicas.
- Health `live`, `ready` y `health`; readiness comprueba DB (`SELECT 1`) y storage sin exponer rutas/URL.
- Request ID, ruta plantilla, status y categoría de error en registro saneado. Sprint 12 agregó warning configurable para solicitudes lentas, sin consulta ni body.
- Headers de seguridad y navegación por rol: Playwright 4/4 PASS; sesión/admin/logout y roles cubiertos.

## Pendiente antes de compartir

No hay TLS, proxy de confianza, rate limiter distribuido, gestión de secretos del destino, retención/alertas ni ACL institucional firmada en este entorno. El piloto sigue local. No desactivar controles en un entorno compartido. Las pruebas locales no constituyen certificación de seguridad.

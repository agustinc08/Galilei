# Configuración de preproducción

Esta es una especificación; no hay entorno de preproducción provisionado ni secretos reales.

Separar `development`, `test`, `preproduction` y `production`. La configuración de destino debe inyectar, fuera del repositorio: `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `BJC_CORPUS_STORAGE_PATH`, CORS origins, log level, límites/ventanas de rate limit, `BJC_SLOW_SEARCH_MS`, `BJC_SEARCH_STATEMENT_TIMEOUT_MS`, host/puerto, tamaño/rango/timeout de archivos, y configuración explícita de proxy/IP si hay proxy confiable. `.env.example` enumera defaults DEV; no copiar credenciales de DEV.

El arranque debe fallar claramente cuando falten DB, JWT o storage críticos. No usar defaults localhost como configuración compartida. TLS, orígenes reales, ACL, política de publicación, retención, monitoreo y rate limit distribuido necesitan valores aprobados por operadores institucionales. Antes de servir usuarios, cerrar búsqueda/concurrencia, restore aislado y migraciones desde cero.

# Sprint 10 — Hardening del piloto local

## Confirmado

- Operaciones Prisma/test/import protegidas: host `127.0.0.1`, puerto `55432`, DB `buscador_juridico_civil_dev`, rol `bjc_dev`.
- Descarga Corpus verifica visibilidad, contención del path en storage, checksum y byte range; probó respuesta `206`, `Accept-Ranges`, `Content-Disposition` seguro, `Cache-Control: private, no-store` y `nosniff`. El path físico no se entrega al cliente.
- Cabeceras globales: `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy` y `Permissions-Policy`; Playwright las verificó.
- DTO global con whitelist/transform/rechazo de extras, CORS explícito y JWT de 8 horas.

## Pendiente antes de ampliar/exponer

JWT persiste en `localStorage`; no se implementó refresh/revocación ni rate limit dedicado a search/matches/download. No hubo prueba concurrente ni revisión externa de errores/headers en cada ruta histórica. Mantener el piloto en entorno local controlado; acordar política de sesión, límites, monitoreo e incidentes antes de red compartida o preproducción. No es producción-ready.

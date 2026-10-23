# 137 — Release notes de preparación preprod

**Release:** candidato documental `Sprint 13 / preparado`, no desplegado. No asignar versión de producto ni afirmar release disponible antes de build/deploy identificados.

## Desde Sprint 12.3

- Se preparó topology inventory, guion UAT institucional, registro de hallazgos y matrices propuestas de ACL, anonimización y retención.
- Se documentaron límites operativos, plan de benchmark preprod, ingesta/proyección segura, guía piloto provisional y runbook de despliegue condicionado.
- Se consolidó el dictamen: Sprint 12.3 habilita continuar hacia preproducción controlada; la Sprint 13 no contó con host separado ni participantes humanos.
- La configuración Playwright ahora enlaza el frontend de prueba a `127.0.0.1` para limitar listeners al loopback; regresión E2E local 5/5.
- El backend incorpora `src/config/preprod-config.ts`: al declarar `NODE_ENV=production` y `BJC_DEPLOYMENT_ENV=preprod`, valida fail-closed el destino DB aprobado, secreto/expiración JWT, origins HTTPS, storage separado, rate limit, una réplica y timeout. La suite usa valores sintéticos y no conecta a base.
- `scripts/with-preprod-db-guard.cjs` valida la misma configuración antes de `prisma migrate status/deploy`; la acción `check` no conecta.

## Sin cambios de producto en esta Sprint

No se cambió la funcionalidad Search, schema, corpus ni cuentas; no se desplegó build. Los cambios de código son configuración de seguridad preprod y bind de loopback para Playwright. Resultados de Search de doc 125 son evidencia DEV Sprint 12.3, no de esta release. No hay release ID, URL, migración o rollback ejecutados.

## Restricciones conocidas

No producción/red compartida; no conexión institucional; no scraping CIJ/CSJN; no publicación ni reglas ACL asumidas; metadata Digesto/crosswalk pendiente. Ver doc 138.

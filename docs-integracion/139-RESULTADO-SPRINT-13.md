# 139 — Resultado Sprint 13: preproducción y UAT

**Fecha de corte:** 2026-10-08. **Estado de entrada:** Sprint 12.3 `READY WITH NON-BLOCKING ADJUSTMENTS` para continuar a preproducción controlada/UAT, sólo sobre evidencia DEV. No es autorización de producción.

## Dictamen

- **Technical preprod: BLOCKED / NOT EXECUTED.** No se identificó un host institucional preprod, proxy/TLS, DB ni storage separados. El único PostgreSQL confirmado es DEV loopback `bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev`; no se reutilizó ni modificó como preprod. Esta ausencia de ambiente no es una falla funcional del producto.
- **UAT institucional: PENDING.** No hubo participantes humanos autorizados ni sesión. Playwright/cuentas sintéticas no son aceptación.
- **ACL: PENDING. Anonimización: PENDING. Retención: PENDING.** Se entregan matrices de decisión; ninguna política fue inferida o aplicada.
- **Digesto export: PENDING.** No se recibió export/crosswalk autorizado; UAT de otros perfiles no depende de importarlo. CIJ/CSJN bulk automatizado continúa NO GO.
- **Production readiness: NOT READY FOR PRODUCTION PLANNING.** Faltan preprod técnica, UAT, policies, responsables, backup/monitoring y SLO real.

## PREPRODUCTION TOPOLOGY

Host: equipo local `AGUSTINNOTEBOOK`, no autorizado como host institucional. Frontend/backend: código local, sin despliegue Sprint 13. PostgreSQL: DEV `127.0.0.1:55432`, sólo referencia; sin DB preprod. Storage: DEV local; sin volumen preprod. Proxy/TLS: no configurados para BJC compartido. Backup preprod: inexistente; evidencia DEV histórica docs 90/123.

## DEPLOY

Migration: no ejecutada. Build: no se produjo release preprod. Health: no hubo target preprod. Projection: no se reconstruyó ni modificó. Result: **no deploy**.

## DATA

Sin carga preprod. Como referencia local heredada de Sprint 12.3: Corpus 11.008 documentos / 9.475.712 tokens; 0 stale y muestra 100/100; 20 migraciones, 44 tablas y `pg_trgm 1.6` en DEV. Estos valores no describen una DB preprod. Los detalles completos de DATA aprobado para el pilot requieren un manifest y reglas institucionales.

## SEARCH PREPROD

TERM, ZERO, PHRASE, PREFIX, SUFFIX, SHORT, FIELD, AND, OR, NOT, COMPLEX: **no medidos en preprod**. Paridad preprod: no ejecutada. Referencia DEV doc 120: TERM común 119/234 ms p50/p95; ZERO 16/19; PHRASE 1.400/1.459; PREFIX 456/577; SUFFIX 965/1.169; SHORT 1.718/1.899; FIELD 1.698/2.115; AND 732/800; OR 1.174/1.227; NOT 820–1.003 / 1.078–1.134; COMPLEX 1.787/1.875. Paridad local histórica 40/40, no reemplaza comparación preprod.

## CONCURRENCY

Preprod 1/5/10: no ejecutada. Referencia DEV local in-process (doc 121): Search p95 259/1.331/2.619 ms a 1/5/10; HTTP/fuente errors 0/0; 20 usuarios p95 4.284 ms y Prisma wait peak 123. No hubo load test contra host compartido.

## UAT — LECTOR / JURISPRUDENCIA / DIGESTO / REVISOR / ADMIN

Todas las áreas: sin sesión/participante; tareas PASS/FAIL no medidas; feedback pendiente. Guion listo en doc 127; hallazgos listos en doc 128. La ausencia de hallazgos observados no es resultado PASS.

## FINDINGS / FIXES

P0 de UAT: no evaluado, porque no se ejecutó UAT. Se cerró por código un **P1 técnico de predeploy**: en modo `NODE_ENV=production`, si el destino es `preprod`, ahora se verifica fail-closed la identidad declarada de DB, secrets/expiry, origins HTTPS, storage separado, rate limit habilitado y una sola réplica antes de iniciar Nest. Las pruebas sintéticas del validator pasan; aún falta prueba positiva/negativa en host preprod autorizado. `LOG_LEVEL` no está aplicado. Otros hallazgos UAT P1/P2/P3: no evaluados. No hubo correcciones funcionales Search durante Sprint 13; ajustes previos permanecen en docs 120–124.

## ACL / ANONYMIZATION / RETENTION

ACL: PENDING; sin roles institucionales aprobados. Anonimización/visibilidad: PENDING; no hay reglas aprobadas ni proceso masivo ejecutado. Retención/auditoría: PENDING; no se fijaron plazos.

## DIGESTO EXPORT

Estado: PENDING. Owner: por asignar. Formato: usar contrato doc 80 (manifest/source IDs/documentos/taxonomía/membership/visibilidad); no recibido. Próximo paso: obtener paquete por canal institucional autorizado y ejecutar dry-run antes de import; alternativa sólo si owner acepta formalmente `NOT REQUIRED FOR PILOT`.

## INGESTION

No se probaron nuevos documentos/extracción/proyección ni latencia a Search en preprod. No hubo escaneo de roots ni cambios en originales. Procedimiento condicionado: doc 133.

## OPERATIONS / SECURITY

Health/logs/slow Search/backup/monitoring/disk: no hay target preprod, por lo que no verificables. TLS/CORS/trust proxy/JWT/rate limit/roles/descargas: valores reales requieren IT y aceptación de perfiles. En una corrida previa del smoke UI local, un Search emitió `slow_search` a 2.032 ms frente al umbral local 1.500 ms; no hubo error, y la corrida Playwright final 5/5 no emitió alerta. Es una observación DEV, no medición de capacidad preprod. Código local tiene readiness DB/storage y rate limit por proceso; esto no configura una instancia compartida.

## BACKEND / FRONTEND / PLAYWRIGHT / BUILDS

Validación local Sprint 13, sin target preprod: `prisma generate` PASS detrás del guard que confirmó DEV; backend Jest 20 suites PASS, 92 pruebas PASS y 15 omitidas; backend/frontend `tsc --noEmit` PASS; Nest build PASS detrás del guard; Next production build PASS; Playwright 5/5 PASS contra servicios locales DEV. El validator preprod tuvo suite aislada 6/6 con valores sintéticos, sin conexión de red. El test web server de Playwright quedó enlazado a `127.0.0.1` para no escuchar en todas las interfaces. El preprod DB guard pasó y abortó en `check` respectivamente con configuración sintética y vacía, ambos sin conexión; migrate-status/deploy no se ejecutaron. No se repitieron opt-ins PostgreSQL/Corpus ni parity porque no hubo cambios de Search, schema o corpus; docs 125 conservan sus resultados recientes. Estas pruebas no son deploy ni smoke preprod; repetir suites relevantes sobre el release candidato y añadir retests humanos antes del gate.

## DOCUMENTOS Y SIGUIENTE GATE

Documentos 126–139 preparados. Master docs BJC actualizados para registrar Sprint 13 y mantener como vigente el corte 12.3. Sólo cambió la dirección de bind del web server de Playwright a loopback; no hubo cambio funcional de producto. Siguiente: institución provee host/DB/storage y owner IT autorizados; áreas definen ACL, anonimización, retención y corpus; luego deploy aislado, smoke, performance 1/5/10, backup/restore y UAT por perfil. Ningún paso autoriza producción automáticamente.

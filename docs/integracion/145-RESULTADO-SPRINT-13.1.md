# 145 — Resultado Sprint 13.1: paquete bootstrap preprod

**Fecha de corte:** 2026-10-08. **Estado del ambiente:** BLOCKED / NOT EXECUTED. **UAT humana:** PENDING.

## PRODUCT STATUS

Sprint 12.3 continúa como último gate técnico de software aceptado para avanzar a preproducción controlada/UAT, basado en evidencia DEV. Sprint 13 no fue una falla funcional: preproducción fue `BLOCKED / NOT EXECUTED` por ausencia de host, DB, storage, DNS/TLS/proxy autorizados. Sprint 13.1 no agrega funcionalidad Search ni cambia su ranking.

## INFRASTRUCTURE REQUEST

Host/OS, CPU/RAM/SSD, PostgreSQL 16/DB/rol, Node, storage/ruta/cuota, DNS, proxy/TLS, firewall/puertos, vault/cuenta técnica, backup/restore/RPO/RTO y usuarios/corpus esperados están solicitados en doc 140. Capacidad no se sobredimensiona: se entregan mediciones DEV de Sprint 12.3 como referencia no contractual.

## CONFIG VALIDATION

Se conserva el validator preprod fail-closed y se agrega rechazo explícito de loopback aunque coincida con identidad declarada. La guarda mantiene `check` sin conexión y amplía allowlist a reporte DB/proyección rebuild/verify/repair. Reporte y proyección verifican DB/rol/puerto efectivos tras conectar. Tests sintéticos nuevos incluidos. No se configuró ni probó una DB institucional.

## DEPLOY AUTOMATION

Preparados `scripts/backup-preprod.ps1`, `scripts/deploy-preprod.ps1`, guardas, verificación efectiva de identidad, backup DB+storage con SHA-256, status/deploy explícito, builds, inicio mediante hook del service manager, readiness, projection verify, reporte y smoke. Los scripts exigen target/approval; no fueron ejecutados contra un target porque no existe. Migraciones no corren en startup.

## CORPUS BOOTSTRAP

La modalidad A (corpus completo autorizado), B (subset aprobado) o C (fixtures) queda a elección del owner. No se copió ni importó corpus. Doc 144 define manifest de conteos/bytes/hashes/source/timestamp y bootstrap condicional. Digesto export/crosswalk PENDING. CIJ/CSJN descarga masiva automatizada sigue NO GO.

## SEARCH BOOTSTRAP

Guardas de proyección preprod `rebuild`, `verify`, `repair` separadas del script DEV. No se reconstruyó proyección. No se hizo smoke Search ni carga 1/5/10 contra preprod. Se preparó Playwright de smoke y harness separado 1/5/10 con origins HTTPS, aprobación, cuenta/ID aprobados y reportes JSON sin consulta, contenido ni credenciales.

## UAT PACKAGE

Doc 141 define tareas concretas y matriz LECTOR/REVISOR/JURISPRUDENCIA/DIGESTO/ADMIN. No se crearon cuentas ni se simuló aceptación humana. Resultado HUMAN ACCEPTANCE: PENDING.

## ACL / ANONYMIZATION / RETENTION

Doc 142 deja todas las decisiones pendientes para owners institucionales. No se infirió ni aplicó política.

## TESTS

Backend: Jest 93 PASS / 15 omitidas; backend typecheck PASS; Nest build PASS bajo guard DEV. Frontend typecheck PASS; Next build PASS; Playwright local 5/5 PASS. Validator/config: 7/7 PASS. Guard preprod: `check` sintético PASS con `NO_DATABASE_CONNECTION=TRUE`; configuración vacía y loopback ABORT esperados. Sintaxis de scripts Node/PowerShell PASS. Ninguna prueba se dirigió a preprod ni a red institucional; el smoke Playwright preprod queda sin ejecutar por ausencia de target/cuenta aprobados.

## DOCUMENTS

- 140: solicitud de infraestructura/SYTEC y base de capacidad medida.
- 141: guion UAT por perfil.
- 142: hoja ACL/anonimización/retención y Digesto.
- 143: checklist de bootstrap y go/no-go.
- 144: comandos, backup/restore, deploy, smoke, monitoring y release.
- 145: resultado y estado de Sprint 13.1.

# PREPRODUCTION ENVIRONMENT

**BLOCKED / NOT AVAILABLE.** No hubo conexión, migración, copia de corpus, deploy, smoke o carga preprod.

# PRODUCT TECHNICAL STATUS

**READY FOR PREPRODUCTION DEPLOY**, condicionado a que infraestructura provea un target aislado y a que los gates de migración, backup, smoke y operación pasen en ese release. Esto no equivale a disponibilidad actual de preprod ni autorización de producción.

# HUMAN ACCEPTANCE

**PENDING.** Requiere usuarios institucionales y tareas completadas con acta del doc 141.

# NEXT REQUIRED EXTERNAL ACTION

SYTEC/Infraestructura debe devolver el formulario doc 140 completo, autorizar host privado y acceso, provisionar PostgreSQL 16 con DB/rol separados, storage persistente, DNS/proxy/TLS, firewall/vault, backup y service manager; además acordar owner, corpus A/B/C, capacidad y ventana. Owners funcionales deben resolver ACL, anonimización, retención, usuarios y Digesto. Al recibirlo, ejecutar el bootstrap en ese host autorizado y completar UAT humana. No modificar más Search preventivamente mientras falte ese ambiente.
